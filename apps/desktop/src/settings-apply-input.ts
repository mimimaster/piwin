import type { ApplySettingsInput, SettingsDomain, SettingsMutation, SettingsSnapshot } from '@piwin/contracts';

export function settingsApplyInputFromSnapshot(
  snapshot: Pick<SettingsSnapshot, 'revision' | 'domainRevisions'>,
  mutations: SettingsMutation[],
): ApplySettingsInput {
  const expectedDomainRevisions: Partial<Record<SettingsDomain, string>> = {};
  for (const mutation of mutations) {
    const hash = snapshot.domainRevisions?.[mutation.domain];
    if (typeof hash === 'string' && hash.length > 0) {
      expectedDomainRevisions[mutation.domain] = hash;
    }
  }
  return {
    expectedRevision: snapshot.revision,
    mutations,
    expectedDomainRevisions,
  };
}
