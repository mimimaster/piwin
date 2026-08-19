import {
  createDefaultSessionColdStorageConfig,
  type SessionColdStorageConfig,
} from '@piwin/contracts';

export type SessionColdStorageDraft = {
  enabled: boolean;
  packOutputDir: string;
  minArchivedAgeDays: string;
  localBudgetBytes: string;
};

export function coldStorageToDraft(
  config: SessionColdStorageConfig | undefined,
): SessionColdStorageDraft {
  const resolved = config ?? createDefaultSessionColdStorageConfig();
  return {
    enabled: resolved.enabled,
    packOutputDir: resolved.packOutputDir ?? '',
    minArchivedAgeDays: String(resolved.minArchivedAgeDays),
    localBudgetBytes:
      typeof resolved.localBudgetBytes === 'number' ? String(resolved.localBudgetBytes) : '',
  };
}

export function draftToColdStorage(draft: SessionColdStorageDraft): SessionColdStorageConfig {
  const minArchivedAgeDays = Number.parseInt(draft.minArchivedAgeDays, 10);
  const config: SessionColdStorageConfig = {
    enabled: draft.enabled,
    minArchivedAgeDays:
      Number.isInteger(minArchivedAgeDays) && minArchivedAgeDays > 0 ? minArchivedAgeDays : 30,
  };
  const outputDir = draft.packOutputDir.trim();
  if (outputDir.length > 0) {
    config.packOutputDir = outputDir;
  }
  const budget = Number.parseInt(draft.localBudgetBytes, 10);
  if (Number.isInteger(budget) && budget > 0) {
    config.localBudgetBytes = budget;
  }
  return config;
}

export function coldStorageDraftDirty(
  draft: SessionColdStorageDraft,
  saved: SessionColdStorageConfig | undefined,
): boolean {
  const savedDraft = coldStorageToDraft(saved);
  return (
    draft.enabled !== savedDraft.enabled ||
    draft.packOutputDir !== savedDraft.packOutputDir ||
    draft.minArchivedAgeDays !== savedDraft.minArchivedAgeDays ||
    draft.localBudgetBytes !== savedDraft.localBudgetBytes
  );
}
