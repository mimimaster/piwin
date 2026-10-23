/** Settings read and apply flow shared by panel request adapters. */
import type { HostResponse, PiwinConfig, SettingsMutation } from '@piwin/contracts';
import { partitionRemoteSettingsMutations } from '@piwin/contracts';
import type { HostClient } from '../host/host-client.js';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { isSettingsRevisionConflict } from '../host/host-problem-copy.js';
import { enqueueSettingsApply } from './settings-apply-chain.js';
import {
  settingsApplyInputFromSnapshot,
  settingsMutationsAdmittedByRemoteSnapshot,
} from './settings-apply-input.js';
import { settingsMutationsFromViewDraft } from './settings-view-config.js';

export async function getSettingsAsLegacyConfigView(hostClient: HostClient): Promise<HostResponse> {
  const response = await hostClient.request({ type: 'settings/get' });
  if (!response.success) {
    return response;
  }
  const data = response.data as {
    snapshot?: {
      config: PiwinConfig;
      revision: string;
      schemaVersion: number;
    };
    root?: string;
  };
  if (!data.snapshot) {
    return {
      ...response,
      success: false,
      error: 'settings/get returned no snapshot',
    };
  }
  return {
    ...response,
    data: {
      config: data.snapshot.config,
      root: data.root ?? (hostClient.getTransport() === 'remote' ? 'Remote Host' : '~/.piwin'),
      revision: data.snapshot.revision,
      schemaVersion: data.snapshot.schemaVersion,
    },
  };
}

export function allowedRemoteSettingsMutations(
  requested: SettingsMutation[],
): SettingsMutation[] | undefined {
  const { allowed, blocked } = partitionRemoteSettingsMutations(requested);
  if (allowed.length > 0) {
    return allowed;
  }
  return blocked.length > 0 ? undefined : allowed;
}

/** Remote Hosts reject `desktop`. Write the shared defaults instead. */
export function composerProfileSettingsMutations(input: {
  transport: string;
  currentDesktop: PiwinConfig['desktop'];
  composerProfile: NonNullable<PiwinConfig['desktop']>['composerProfile'];
  currentThinking: PiwinConfig['thinking'];
  selectedModel: { providerId: string; modelId: string } | undefined;
}): SettingsMutation[] {
  const desktopMutation: SettingsMutation = {
    kind: 'replace-domain',
    domain: 'desktop',
    value: {
      ...input.currentDesktop,
      composerProfile: input.composerProfile,
    } as NonNullable<PiwinConfig['desktop']>,
  };
  if (input.transport === 'remote') {
    const mutations: SettingsMutation[] = [desktopMutation];
    if (input.selectedModel) {
      mutations.push({
        kind: 'replace-domain',
        domain: 'defaultProviderId',
        value: input.selectedModel.providerId,
      });
      mutations.push({
        kind: 'replace-domain',
        domain: 'defaultModelId',
        value: input.selectedModel.modelId,
      });
    }
    const thinkingLevel = input.composerProfile?.thinkingLevel;
    mutations.push({
      kind: 'replace-domain',
      domain: 'thinking',
      value: {
        ultraEnabled: input.currentThinking?.ultraEnabled === true,
        ...(thinkingLevel === undefined ? {} : { defaultLevel: thinkingLevel }),
      },
    });
    return mutations;
  }
  return [desktopMutation];
}

/** Remote Hosts reject `desktop`. Skip it instead of toasting a payload reject. */
export function settingsMutationsForHostApply(
  requested: SettingsMutation[],
  transport: string,
): SettingsMutation[] {
  if (transport !== 'remote') {
    return requested;
  }
  return partitionRemoteSettingsMutations(requested).allowed;
}

export async function applyConfigDraft(
  hostClient: HostClient,
  nextConfig: PiwinConfig,
): Promise<HostResponse> {
  return enqueueSettingsApply(async () => {
    const first = await applyConfigDraftOnce(hostClient, nextConfig);
    if (!isSettingsRevisionConflict(first)) {
      return first;
    }
    return applyConfigDraftOnce(hostClient, nextConfig);
  });
}

async function applyConfigDraftOnce(
  hostClient: HostClient,
  nextConfig: PiwinConfig,
): Promise<HostResponse> {
  const currentResponse = await hostClient.request({ type: 'settings/get' });
  if (!currentResponse.success) {
    return currentResponse;
  }
  const data = currentResponse.data as {
    snapshot?: {
      config: PiwinConfig;
      revision: string;
      domainRevisions?: import('@piwin/contracts').SettingsSnapshot['domainRevisions'];
    };
  };
  if (!data.snapshot) {
    return {
      type: 'response',
      command: 'settings/apply',
      success: false,
      error: 'settings/get returned no snapshot',
    };
  }
  const requested = settingsMutationsFromViewDraft(data.snapshot.config, nextConfig);
  const emptyApply = {
    type: 'response' as const,
    command: 'settings/apply' as const,
    success: true as const,
    data: { snapshot: data.snapshot, changedDomains: [] },
  };
  let mutations: SettingsMutation[];
  if (hostClient.getTransport() === 'remote') {
    const admitted = allowedRemoteSettingsMutations(requested);
    if (admitted === undefined) {
      return emptyApply;
    }
    mutations = settingsMutationsAdmittedByRemoteSnapshot(
      admitted,
      data.snapshot.domainRevisions,
      data.snapshot.config.notes,
    );
    if (admitted.length > 0 && mutations.length === 0) {
      return {
        type: 'response',
        command: 'settings/apply',
        success: false,
        error: 'Remote Host does not accept these settings domains yet',
      };
    }
  } else {
    mutations = requested;
  }
  if (mutations.length === 0) {
    return emptyApply;
  }
  return hostClient.request(
    {
      type: 'settings/apply',
      input: settingsApplyInputFromSnapshot(
        {
          revision: data.snapshot.revision,
          domainRevisions: data.snapshot.domainRevisions ?? {},
        },
        mutations,
      ),
    },
    { idempotencyKey: createGestureIdempotencyKey() },
  );
}
