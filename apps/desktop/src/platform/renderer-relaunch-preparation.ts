/** Explicit shutdown preparation only; memory pressure must never terminate the shell. */
export const BEFORE_RENDERER_RELAUNCH_EVENT = 'piwin:before-renderer-relaunch';

export function prepareRendererRelaunch(): boolean {
  if (typeof window !== 'undefined') {
    return window.dispatchEvent(new Event(BEFORE_RENDERER_RELAUNCH_EVENT, { cancelable: true }));
  }
  return true;
}
