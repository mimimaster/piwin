import type { SessionColdStoragePlan, SessionStorageInfo } from '@piwin/contracts';

export function isSessionBodyOffloaded(
  storage: SessionStorageInfo | undefined,
): boolean {
  return storage?.state === 'offloaded' || storage?.state === 'missing-pack';
}

export function sessionStorageBadgeKind(
  storage: SessionStorageInfo | undefined,
): 'offloaded' | 'missing-pack' | undefined {
  if (storage?.state === 'offloaded' || storage?.state === 'missing-pack') {
    return storage.state;
  }
  return undefined;
}

export function canExecuteColdStoragePlan(input: {
  enabled: boolean;
  packOutputDir: string;
  draftDirty: boolean;
  plan: SessionColdStoragePlan | null;
}): boolean {
  if (!input.enabled) return false;
  if (input.packOutputDir.trim().length === 0) return false;
  if (input.draftDirty) return false;
  if (!input.plan || input.plan.targets.length === 0) return false;
  if (input.plan.confirmationDigest.trim().length === 0) return false;
  return true;
}
