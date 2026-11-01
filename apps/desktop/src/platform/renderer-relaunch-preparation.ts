/** Native renderer reclamation uses SIGKILL, which never delivers pagehide. */
export const BEFORE_RENDERER_RELAUNCH_EVENT = 'piwin:before-renderer-relaunch';

export function prepareRendererRelaunch(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(BEFORE_RENDERER_RELAUNCH_EVENT));
  }
}
