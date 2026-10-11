/** Native window resize bursts share the transcript's panel-resize budget. */
import { beginPanelResize } from './panel-resize-activity.js';

export const WINDOW_RESIZE_SETTLE_MS = 160;

/** Window resize events have no gesture-end event; settle after a quiet interval. */
export function installWindowResizeActivity(view: Window): () => void {
  const root = view.document.documentElement;
  let previousWidth = view.innerWidth;
  let previousHeight = view.innerHeight;
  let settleTimer: number | null = null;
  let releaseResize: (() => void) | null = null;

  function settle(): void {
    if (settleTimer !== null) {
      view.clearTimeout(settleTimer);
      settleTimer = null;
    }
    // Restore normal layout before follow-tail consumers measure the final box.
    delete root.dataset.windowResizing;
    releaseResize?.();
    releaseResize = null;
  }

  function onResize(): void {
    const width = view.innerWidth;
    const height = view.innerHeight;
    if (width === previousWidth && height === previousHeight) return;
    previousWidth = width;
    previousHeight = height;
    if (releaseResize === null) {
      root.dataset.windowResizing = 'true';
      releaseResize = beginPanelResize();
    }
    if (settleTimer !== null) view.clearTimeout(settleTimer);
    settleTimer = view.setTimeout(settle, WINDOW_RESIZE_SETTLE_MS);
  }

  view.addEventListener('resize', onResize);
  return () => {
    view.removeEventListener('resize', onResize);
    settle();
  };
}
