import { DOCKING_WORKSPACE_FLAG_KEY } from './constants.js';

type StorageReader = Pick<Storage, 'getItem'>;

/**
 * Feature-branch default is ON. Explicit `0`/`false` disables.
 * When enabled, the v1 conversation-pane engine must not write storage.
 */
export function isDockingWorkspaceEnabled(storage?: StorageReader): boolean {
  const resolved =
    storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!resolved) return true;
  const raw = resolved.getItem(DOCKING_WORKSPACE_FLAG_KEY);
  if (raw === null) return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'off') return false;
  if (normalized === '1' || normalized === 'true' || normalized === 'on') return true;
  return true;
}

export function setDockingWorkspaceEnabled(enabled: boolean, storage?: Pick<Storage, 'setItem'>): void {
  const resolved =
    storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!resolved) return;
  resolved.setItem(DOCKING_WORKSPACE_FLAG_KEY, enabled ? '1' : '0');
}
