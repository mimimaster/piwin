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
  const now = deps.now ?? (() => Date.now());
  const getFootprintBytes = deps.getFootprintBytes ?? getLastMemoryPressureBytes;
  const isRunActive = deps.isRunActive ?? (() => false);
  const isUiBlockingModalOpen = deps.isUiBlockingModalOpen ?? defaultUiBlockingModalOpen;
  const isProtectedSurfaceActive = deps.isProtectedSurfaceActive ?? (() => false);
  const recover = deps.recover ?? (() => requestRendererRecovery());

  let lastRecycleAtMs = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const tryRecycle = (): void => {
    timer = null;
    if (document.visibilityState !== 'hidden') return;
    if (isRunActive()) return;
    if (isProtectedSurfaceActive()) return;
    const bytes = getFootprintBytes();
    if (bytes === null || bytes < MEMORY_PRESSURE_CRITICAL_BYTES) return;
    if (isUiBlockingModalOpen()) return;
    const currentMs = now();
    if (currentMs - lastRecycleAtMs < cooldownMs) return;
    lastRecycleAtMs = currentMs;
    recover();
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      clearTimer();
      timer = setTimeout(tryRecycle, hiddenDelayMs);
      return;
    }
    clearTimer();
  };

  document.addEventListener('visibilitychange', onVisibilityChange);
  onVisibilityChange();

  return () => {
    clearTimer();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
