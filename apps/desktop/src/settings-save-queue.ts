/**
 * Serialized settings/apply. Policy is pure so tests can drive skip/apply/
 * failure without standing up App. The hook only owns the in-order queue.
 */
import {
  formatError,
  type HostResponse,
  type PiwinConfig,
  type SettingsMutation,
  type SettingsSnapshot,
} from '@piwin/contracts';
import { settingsMutationsForHostApply } from './host-request-adapters';
import { hostFailureNotice } from './host-problem-copy.js';
import { settingsApplyInputFromSnapshot } from './settings-apply-input.js';
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
  const mutations = settingsMutationsForHostApply(
    input.buildMutations(snapshot.config),
    input.transport,
  );
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
