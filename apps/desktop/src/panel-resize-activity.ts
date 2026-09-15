/**
 * Live pointer drag of a workbench panel edge (left navigator, right panel).
 *
 * Every drag frame reflows the transcript column. Consumers that keep layout
 * in sync (transcript follow-tail) use this signal to coalesce their forced
 * layout reads to one per frame and settle once when the drag ends.
 */

export type PanelResizeActivityListener = (active: boolean) => void;

const activeDragTokens = new Set<symbol>();
const listeners = new Set<PanelResizeActivityListener>();

function notify(active: boolean): void {
  for (const listener of listeners) {
    listener(active);
  }
}

export function isPanelResizeActive(): boolean {
  return activeDragTokens.size > 0;
}

/** Mark a drag as started; the returned release is idempotent. */
export function beginPanelResize(): () => void {
  const token = Symbol('panel-resize');
  const wasActive = isPanelResizeActive();
  activeDragTokens.add(token);
  if (!wasActive) {
    notify(true);
  }
  return () => {
    if (!activeDragTokens.delete(token)) {
      return;
    }
    if (!isPanelResizeActive()) {
      notify(false);
    }
  };
}

export function subscribePanelResizeActivity(listener: PanelResizeActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
