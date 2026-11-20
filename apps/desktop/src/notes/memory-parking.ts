/**
 * Occlusion-driven parking: after the window has been hidden long enough,
 * strip remaining glass and ask WebKit to drop its memory cache. The
 * attribute is removed on the same visibility turn that brings the window
 * back, so the user never sees the parked look.
 *
 * Must not touch MemoryGovernor — pressure and parking are independent.
 */
import { requestNativeWebviewMemoryPurge } from './memory-pressure';

export const PARK_AFTER_HIDDEN_MS = 120_000;

let installed = false;
let parkTimer: ReturnType<typeof setTimeout> | null = null;
let parked = false;
let removeVisibilityListener: (() => void) | null = null;

function clearParkTimer(): void {
  if (parkTimer !== null) {
    clearTimeout(parkTimer);
    parkTimer = null;
  }
}

function applyParked(next: boolean): void {
  if (typeof document === 'undefined' || parked === next) {
    return;
  }
  parked = next;
  if (next) {
    document.documentElement.dataset.memoryParked = '';
    void requestNativeWebviewMemoryPurge();
    return;
  }
  delete document.documentElement.dataset.memoryParked;
}

function onVisibilityChange(): void {
  if (typeof document === 'undefined') {
    return;
  }
  if (document.visibilityState === 'hidden') {
    clearParkTimer();
    parkTimer = setTimeout(() => {
      parkTimer = null;
      applyParked(true);
    }, PARK_AFTER_HIDDEN_MS);
    return;
  }
  clearParkTimer();
  applyParked(false);
}

export function isMemoryParked(): boolean {
  return parked;
}

export function resetMemoryParking(): void {
  clearParkTimer();
  applyParked(false);
}

export function uninstallMemoryParking(): void {
  removeVisibilityListener?.();
  removeVisibilityListener = null;
  resetMemoryParking();
  installed = false;
}

export function installMemoryParking(): void {
  if (typeof document === 'undefined' || installed) {
    return;
  }
  installed = true;
  document.addEventListener('visibilitychange', onVisibilityChange);
  removeVisibilityListener = () => {
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
  onVisibilityChange();
}
