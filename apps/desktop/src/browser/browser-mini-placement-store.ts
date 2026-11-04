/**
 * Local, client-owned placement memory for the Browser Mini.
 *
 * Geometry is presentation state, not Host state (spec §7): it lives in the
 * client, scoped to one Host so a second Host never inherits a corner that
 * belonged to another machine.
 */
import { browserMiniPlacementToStored, browserMiniPlacementFromStored } from './browser-mini-policy';

const STORAGE_PREFIX = 'piwin.browser-mini.placement.';

export function browserMiniPlacementStorageKey(hostScope: string): string {
  return `${STORAGE_PREFIX}${hostScope}`;
}

/** Hosts with no instance id yet share the local bucket. */
export function browserMiniHostScope(hostInstanceId: string | null): string {
  const id = hostInstanceId?.trim() ?? '';
  return id.length > 0 ? id : 'local';
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readBrowserMiniPlacement(
  key: string,
  container: { width: number; height: number },
): ReturnType<typeof browserMiniPlacementFromStored> {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;
    return browserMiniPlacementFromStored(JSON.parse(raw) as unknown, container);
  } catch {
    return null;
  }
}

export function writeBrowserMiniPlacement(
  key: string,
  point: { x: number; y: number } | null,
  container: { width: number; height: number },
): void {
  const store = storage();
  if (store === null) return;
  try {
    if (point === null) {
      store.removeItem(key);
      return;
    }
    const stored = browserMiniPlacementToStored(point, container);
    if (stored === null) return;
    store.setItem(key, JSON.stringify(stored));
  } catch {
    /* Storage can be disabled; placement is a convenience, never required. */
  }
}
