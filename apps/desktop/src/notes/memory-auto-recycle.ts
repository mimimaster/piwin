/**
 * Idle over-budget auto-recycle for long-lived Desktop WebContent processes.
 *
 * WebKit retains swapped C++ bmalloc arenas and offscreen surface backing
 * stores for as long as the page stays alive. Recycling the renderer via
 * `requestRendererRecovery()` resets footprint back to cold baseline (~250 MB)
 * cleanly without disrupting any Host state, and only fires when ALL safety
 * gates pass simultaneously while the window is hidden.
 */
import {
  getLastMemoryPressureBytes,
  MEMORY_PRESSURE_CRITICAL_BYTES,
} from './memory-pressure.js';
import {
  requestRendererRecovery,
  type RendererRecoveryResult,
} from '../platform/renderer-recovery.js';

export const AUTO_RECYCLE_HIDDEN_MS = 60_000;
export const AUTO_RECYCLE_COOLDOWN_MS = 10 * 60_000;
export const AUTO_RECYCLE_RETRY_MS = 30_000;
export const AUTO_RECYCLE_UNFOCUSED_IDLE_MS = 3 * 60_000;

export type MemoryAutoRecycleDeps = {
  isRunActive?: () => boolean;
  getFootprintBytes?: () => number | null;
  isUiBlockingModalOpen?: () => boolean;
  /** Live renderer-owned surfaces that reload would discard (PTYs, Settings, subpages). */
  isProtectedSurfaceActive?: () => boolean;
  recover?: () => RendererRecoveryResult;
  now?: () => number;
  hiddenDelayMs?: number;
  cooldownMs?: number;
  retryDelayMs?: number;
  unfocusedIdleMs?: number;
};

function defaultUiBlockingModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[role="dialog"], [data-testid="screen-capture-editor"]') !== null;
}

export function installMemoryAutoRecycle(deps: MemoryAutoRecycleDeps = {}): () => void {
  if (typeof document === 'undefined') {
    return () => {};
  }
  const hiddenDelayMs = deps.hiddenDelayMs ?? AUTO_RECYCLE_HIDDEN_MS;
  const cooldownMs = deps.cooldownMs ?? AUTO_RECYCLE_COOLDOWN_MS;
  const retryDelayMs = deps.retryDelayMs ?? AUTO_RECYCLE_RETRY_MS;
  const unfocusedIdleMs = deps.unfocusedIdleMs ?? AUTO_RECYCLE_UNFOCUSED_IDLE_MS;
  const now = deps.now ?? (() => Date.now());
  const getFootprintBytes = deps.getFootprintBytes ?? getLastMemoryPressureBytes;
  const isRunActive = deps.isRunActive ?? (() => false);
  const isUiBlockingModalOpen = deps.isUiBlockingModalOpen ?? defaultUiBlockingModalOpen;
  const isProtectedSurfaceActive = deps.isProtectedSurfaceActive ?? (() => false);
  const recover = deps.recover ?? (() => requestRendererRecovery());

  let lastRecycleAtMs = Number.NEGATIVE_INFINITY;
  let windowBlurred = false;
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  let unfocusedTimer: ReturnType<typeof setTimeout> | null = null;

  const clearHiddenTimer = (): void => {
    if (hiddenTimer !== null) {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
    }
  };

  const clearUnfocusedTimer = (): void => {
    if (unfocusedTimer !== null) {
      clearTimeout(unfocusedTimer);
      unfocusedTimer = null;
    }
  };

  const scheduleHidden = (delayMs: number): void => {
    clearHiddenTimer();
    hiddenTimer = setTimeout(() => tryRecycle('hidden'), delayMs);
  };

  const scheduleUnfocused = (delayMs: number): void => {
    clearUnfocusedTimer();
    unfocusedTimer = setTimeout(() => tryRecycle('unfocused'), delayMs);
  };

  const reschedule = (mode: 'hidden' | 'unfocused'): void => {
    if (mode === 'hidden') {
      if (document.visibilityState === 'hidden') scheduleHidden(retryDelayMs);
      return;
    }
    if (windowBlurred && document.visibilityState !== 'hidden') {
      scheduleUnfocused(retryDelayMs);
    }
  };

  const tryRecycle = (mode: 'hidden' | 'unfocused'): void => {
    if (mode === 'hidden') {
      hiddenTimer = null;
      if (document.visibilityState !== 'hidden') return;
    } else {
      unfocusedTimer = null;
      if (!windowBlurred || document.visibilityState === 'hidden') return;
    }

    if (isRunActive() || isProtectedSurfaceActive() || isUiBlockingModalOpen()) {
      reschedule(mode);
      return;
    }
    const bytes = getFootprintBytes();
    if (bytes === null || bytes < MEMORY_PRESSURE_CRITICAL_BYTES) {
      reschedule(mode);
      return;
    }
    const currentMs = now();
    if (currentMs - lastRecycleAtMs < cooldownMs) {
      reschedule(mode);
      return;
    }
    const result = recover();
    if (!result.allowed) {
      reschedule(mode);
      return;
    }
    lastRecycleAtMs = currentMs;
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      clearUnfocusedTimer();
      scheduleHidden(hiddenDelayMs);
      return;
    }
    clearHiddenTimer();
    if (windowBlurred) {
      scheduleUnfocused(unfocusedIdleMs);
    }
  };

  const onBlur = (): void => {
    windowBlurred = true;
    if (document.visibilityState !== 'hidden') {
      scheduleUnfocused(unfocusedIdleMs);
    }
  };

  const onUserActive = (): void => {
    windowBlurred = false;
    clearUnfocusedTimer();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onUserActive);
    window.addEventListener('pointerdown', onUserActive);
    window.addEventListener('keydown', onUserActive);
  }
  onVisibilityChange();

  return () => {
    clearHiddenTimer();
    clearUnfocusedTimer();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (typeof window !== 'undefined') {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onUserActive);
      window.removeEventListener('pointerdown', onUserActive);
      window.removeEventListener('keydown', onUserActive);
    }
  };
}
