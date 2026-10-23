/**
 * Reading anchor: the message at the top of the viewport and its offset.
 *
 * History paging changes the rows around the reader (older pages prepend,
 * the resident window evicts its far edge). Row-keyed anchoring cannot follow
 * that when one turn spans several pages: the partial head turn is keyed by
 * its first resident message, so prepending into it renames the row, and even
 * a stable key keeps the offset from the row's top — the wrong reference
 * once content lands above the reader inside the same row. The message the
 * reader is looking at is the only stable reference.
 */
import { messageAnchorId } from './transcript-outline.js';

export type TranscriptReadingAnchor = {
  messageId: string;
  /** Distance from the scroll container's top edge to the message's top. */
  offset: number;
};

/** Puts the anchor back on screen; true once it is (or will be) aligned. */
export type TranscriptReadingAnchorRestorer = (anchor: TranscriptReadingAnchor) => boolean;

const MESSAGE_ID_PREFIX = messageAnchorId('');

/** First message whose box reaches into the viewport. */
export function captureTranscriptReadingAnchor(
  container: HTMLElement,
): TranscriptReadingAnchor | null {
  const containerTop = container.getBoundingClientRect().top;
  let best: { element: Element; top: number } | null = null;
  for (const element of container.querySelectorAll(`[id^="${MESSAGE_ID_PREFIX}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= containerTop + 1) {
      continue;
    }
    if (!best || rect.top < best.top) {
      best = { element, top: rect.top };
    }
  }
  if (!best) {
    return null;
  }
  return {
    messageId: best.element.id.slice(MESSAGE_ID_PREFIX.length),
    offset: best.top - containerTop,
  };
}

/**
 * Scroll so the anchor sits where it was. Returns false when the message is
 * not mounted (virtualized away) — the caller must bring its row in first.
 */
export function alignTranscriptReadingAnchor(
  container: HTMLElement,
  anchor: TranscriptReadingAnchor,
  hooks: {
    beforeScroll?: () => void;
    /** Sync scroll bookkeeping that would otherwise wait for the scroll event. */
    afterScroll?: (scrollTop: number) => void;
  } = {},
): boolean {
  const element = document.getElementById(messageAnchorId(anchor.messageId));
  if (!element || !container.contains(element)) {
    return false;
  }
  const delta =
    element.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor.offset;
  if (Math.abs(delta) >= 1) {
    hooks.beforeScroll?.();
    container.scrollTop += delta;
    hooks.afterScroll?.(container.scrollTop);
  }
  return true;
}
