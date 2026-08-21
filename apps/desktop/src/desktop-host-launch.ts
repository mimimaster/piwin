/**
 * Desktop launch preference: local sidecar vs attach-only (no host_start).
 *
 * Separate from the saved remote endpoint (`remote-host-session.ts`). A saved
 * endpoint implies attach; this key remembers the choice when no endpoint is
 * saved yet (connect wall) or when the user explicitly wants the sidecar.
 */

import { isDesktopShellOnlyBuild } from './desktop-shell-build.js';
import {
  loadDesktopRemoteHostTarget,
  type DesktopRemoteHostTarget,
} from './remote-host-session.js';

export type DesktopHostLaunchMode = 'sidecar' | 'attach';

export type DesktopHostResolution =
  | { kind: 'undecided' }
  | { kind: 'attach-wall' }
  | { kind: 'sidecar' }
  | { kind: 'remote'; target: DesktopRemoteHostTarget };

const LAUNCH_MODE_KEY = 'piwin.desktop.host-launch-mode';

const launchModeListeners = new Set<() => void>();

export function loadDesktopHostLaunchMode(): DesktopHostLaunchMode | undefined {
  const raw = getLocalStorage()?.getItem(LAUNCH_MODE_KEY);
  if (raw === 'sidecar' || raw === 'attach') {
    return raw;
  }
  return undefined;
}

export function saveDesktopHostLaunchMode(mode: DesktopHostLaunchMode): void {
  const storage = getLocalStorage();
  const previous = storage?.getItem(LAUNCH_MODE_KEY);
  storage?.setItem(LAUNCH_MODE_KEY, mode);
  if (previous !== mode) {
    notifyDesktopHostLaunchModeListeners();
  }
}

export function clearDesktopHostLaunchMode(): void {
  const storage = getLocalStorage();
  const previous = storage?.getItem(LAUNCH_MODE_KEY);
  storage?.removeItem(LAUNCH_MODE_KEY);
  if (previous !== null && previous !== undefined) {
    notifyDesktopHostLaunchModeListeners();
  }
}

export function subscribeDesktopHostLaunchModeChange(listener: () => void): () => void {
  launchModeListeners.add(listener);
  return () => {
    launchModeListeners.delete(listener);
  };
}

/**
 * Decide whether Desktop may spawn the local Host, must show a wall, or
 * attaches to a saved standalone Host. Saved remote target always wins.
 */
export function resolveDesktopHostResolution(
  shellOnly: boolean = isDesktopShellOnlyBuild(),
): DesktopHostResolution {
  return resolveDesktopHostResolutionWith(
    loadDesktopRemoteHostTarget,
    loadDesktopHostLaunchMode,
    shellOnly,
  );
}

/** Test seam: inject loaders without touching localStorage. */
export function resolveDesktopHostResolutionWith(
  loadTarget: () => DesktopRemoteHostTarget | undefined,
  loadMode: () => DesktopHostLaunchMode | undefined,
  shellOnly = false,
): DesktopHostResolution {
  const target = loadTarget();
  if (target !== undefined) {
    return { kind: 'remote', target };
  }
  if (shellOnly) {
    return { kind: 'attach-wall' };
  }
  const mode = loadMode();
  if (mode === 'attach') {
    return { kind: 'attach-wall' };
  }
  if (mode === 'sidecar') {
    return { kind: 'sidecar' };
  }
  return { kind: 'undecided' };
}

function notifyDesktopHostLaunchModeListeners(): void {
  for (const listener of launchModeListeners) {
    listener();
  }
}

function getLocalStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
