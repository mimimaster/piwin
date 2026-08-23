/**
 * Serialized settings/apply. Policy is pure so tests can drive skip/apply/
 * failure without standing up App. The process-wide chain serializes writers.
 */
import {
  formatError,
  type HostResponse,
  type PiwinConfig,
  type SettingsMutation,
  type SettingsSnapshot,
} from '@piwin/contracts';
import { settingsMutationsForHostApply } from './host-request-adapters';
import { hostFailureNotice, isSettingsRevisionConflict } from './host-problem-copy.js';
import {
  settingsApplyInputFromSnapshot,
  settingsMutationsAdmittedByRemoteSnapshot,
} from './settings-apply-input.js';
import type { DesktopLocale } from './desktop-locale';

export type SettingsGetSnapshot = {
  config: PiwinConfig;
  revision: string;
  domainRevisions?: SettingsSnapshot['domainRevisions'];
};

export type SettingsSavePlan =
  | { kind: 'read-failed'; message: string }
  | { kind: 'missing-snapshot'; message: string }
  | { kind: 'empty-mutations' }
  | {
      kind: 'apply';
      snapshot: SettingsGetSnapshot;
      mutations: SettingsMutation[];
    };

export function readSettingsGetSnapshot(data: unknown): SettingsGetSnapshot | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const snapshot = (data as { snapshot?: unknown }).snapshot;
  if (typeof snapshot !== 'object' || snapshot === null) {
    return null;
  }
  const record = snapshot as {
    config?: PiwinConfig;
    revision?: unknown;
    domainRevisions?: SettingsSnapshot['domainRevisions'];
  };
  if (record.config === undefined || typeof record.revision !== 'string') {
    return null;
  }
  return {
    config: record.config,
    revision: record.revision,
    ...(record.domainRevisions !== undefined ? { domainRevisions: record.domainRevisions } : {}),
  };
}

export function planSettingsSave(input: {
  getResponse: HostResponse;
  buildMutations: (currentConfig: PiwinConfig) => SettingsMutation[];
  transport: string;
}): SettingsSavePlan {
  if (!input.getResponse.success) {
    return { kind: 'read-failed', message: `Settings read failed: ${input.getResponse.error}` };
  }
  const snapshot = readSettingsGetSnapshot(input.getResponse.data);
  if (!snapshot) {
    return { kind: 'missing-snapshot', message: 'Settings read returned no snapshot' };
  }
  const requested = settingsMutationsForHostApply(
    input.buildMutations(snapshot.config),
    input.transport,
  );
  const mutations =
    input.transport === 'remote'
      ? settingsMutationsAdmittedByRemoteSnapshot(
          requested,
          snapshot.domainRevisions,
          snapshot.config.notes,
        )
      : requested;
  if (mutations.length === 0) {
    return { kind: 'empty-mutations' };
  }
  return { kind: 'apply', snapshot, mutations };
}

export type SettingsSaveOutcome =
  | { kind: 'ok' }
  | { kind: 'notice'; message: string };

export function settingsSaveApplyFailureNotice(
  applyResponse: HostResponse,
  locale: DesktopLocale,
): SettingsSaveOutcome {
  if (applyResponse.success) {
    return { kind: 'ok' };
  }
  const notice = hostFailureNotice(applyResponse, locale);
  if (notice.length === 0) {
    return { kind: 'ok' };
  }
  return { kind: 'notice', message: notice };
}

export function settingsSaveThrownNotice(error: unknown): string {
  return `Settings save failed: ${formatError(error)}`;
}

/** First CAS miss is retried against a fresh snapshot; a second miss is a real conflict. */
export function shouldRetrySettingsApply(applyResponse: HostResponse, attempt: number): boolean {
  return attempt === 0 && isSettingsRevisionConflict(applyResponse);
}

export type SettingsSaveCycleResult =
  | { kind: 'ok' }
  | { kind: 'empty' }
  | { kind: 'failed'; message: string };

/**
 * One get→apply cycle with a single CAS retry. Callers serialize this on the
 * process-wide settings apply chain so lastSession persist cannot race a draft.
 */
export async function executeSettingsSaveCycle(input: {
  requestGet: () => Promise<HostResponse>;
  requestApply: (
    plan: Extract<SettingsSavePlan, { kind: 'apply' }>,
  ) => Promise<HostResponse>;
  buildMutations: (currentConfig: PiwinConfig) => SettingsMutation[];
  transport: string;
  locale: DesktopLocale;
}): Promise<SettingsSaveCycleResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const getResponse = await input.requestGet();
    const plan = planSettingsSave({
      getResponse,
      buildMutations: input.buildMutations,
      transport: input.transport,
    });
    if (plan.kind === 'read-failed' || plan.kind === 'missing-snapshot') {
      return { kind: 'failed', message: plan.message };
    }
    if (plan.kind === 'empty-mutations') {
      return { kind: 'empty' };
    }
    const applyResponse = await input.requestApply(plan);
    if (applyResponse.success) {
      return { kind: 'ok' };
    }
    if (shouldRetrySettingsApply(applyResponse, attempt)) {
      continue;
    }
    const outcome = settingsSaveApplyFailureNotice(applyResponse, input.locale);
    if (outcome.kind === 'notice') {
      return { kind: 'failed', message: outcome.message };
    }
    return { kind: 'ok' };
  }
  return { kind: 'failed', message: 'settings-revision-conflict' };
}

export function settingsApplyCommand(plan: Extract<SettingsSavePlan, { kind: 'apply' }>): {
  type: 'settings/apply';
  input: ReturnType<typeof settingsApplyInputFromSnapshot>;
} {
  return {
    type: 'settings/apply',
    input: settingsApplyInputFromSnapshot(
      {
        revision: plan.snapshot.revision,
        domainRevisions: plan.snapshot.domainRevisions ?? {},
      },
      plan.mutations,
    ),
  };
}
