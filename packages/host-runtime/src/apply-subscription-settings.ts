import type { HostPush, PiwinConfig, SettingsApplyResult } from '@piwin/contracts';
import { buildSettingsDomainMutations } from '@piwin/contracts';
import { SettingsService } from './settings/settings-service.js';

export type ApplySubscriptionSettingsInput = {
  piwinRoot?: string;
  next: PiwinConfig;
  push?: (message: HostPush) => void;
  onApplied?: (result: SettingsApplyResult) => void;
};

/**
 * Persist OAuth-driven config (relocate / default seed) through SettingsService
 * so revision, settings/updated, and the serialized write queue stay shared.
 */
export async function applySubscriptionSettings(
  input: ApplySubscriptionSettingsInput,
): Promise<SettingsApplyResult | undefined> {
  const service = new SettingsService(
    input.piwinRoot !== undefined ? { piwinRoot: input.piwinRoot } : {},
  );
  const snapshot = await service.getSnapshot();
  const mutations = buildSettingsDomainMutations(snapshot.config, input.next);
  if (mutations.length === 0) {
    return { snapshot, changedDomains: [] };
  }
  const result = await service.apply({
    expectedRevision: snapshot.revision,
    mutations,
  });
  if (result.changedDomains.length > 0) {
    input.push?.({
      type: 'settings/updated',
      revision: result.snapshot.revision,
      runtimeRevision: result.snapshot.runtimeRevision,
      changedDomains: result.changedDomains.map((impact) => impact.domain),
    });
    input.onApplied?.(result);
  }
  return result;
}
