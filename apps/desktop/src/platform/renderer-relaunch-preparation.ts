/** Native renderer reclamation uses SIGKILL, which never delivers pagehide. */
export const BEFORE_RENDERER_RELAUNCH_EVENT = 'piwin:before-renderer-relaunch';

export function prepareRendererRelaunch(): boolean {
  if (typeof window !== 'undefined') {
    return window.dispatchEvent(new Event(BEFORE_RENDERER_RELAUNCH_EVENT, { cancelable: true }));
  }
  return true;
}
