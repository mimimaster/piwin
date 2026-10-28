/**
 * One way to jump to a history turn, shared by the tick rail and the turn
 * scrollbar: resident rows first, then a Host seek around the indexed anchor.
 */
import type { SessionUserMessageAnchor } from '@piwin/contracts';
import { messageAnchorId } from '../conversation/transcript-outline';
import type { TranscriptScrollPort } from '../conversation/transcript-scroll-port';

export type HistoryAnchorJumpHandler = (anchor: SessionUserMessageAnchor) => Promise<void> | void;

/** Scroll the transcript to a message anchor. Instant: smooth scrolling fights
 *  the virtualizer and follow-tail stick, which reads as a laggy jump. */
export function scrollTranscriptToMessage(messageId: string): boolean {
  const targetElement = document.getElementById(messageAnchorId(messageId));
  if (!targetElement) {
    return false;
  }

  const scrollParent = targetElement.closest('.chat-stream');
  if (scrollParent instanceof HTMLElement) {
    const parentRect = scrollParent.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const targetCenterY = targetRect.top + targetRect.height / 2;
    const parentCenterY = parentRect.top + parentRect.height / 2;
    const nextScrollTop = scrollParent.scrollTop + (targetCenterY - parentCenterY);
    scrollParent.scrollTo({ top: nextScrollTop, behavior: 'auto' });
  } else {
    targetElement.scrollIntoView({ behavior: 'auto', block: 'center' });
  }

  return true;
}

/**
 * Jump to a user message. Resident rows scroll
 * in place; otherwise the Host window around `anchor` is fetched and the
 * row is settled over the next frames while the window commits.
 */
export function jumpToHistoryMessage(options: {
  port: TranscriptScrollPort | null;
  messageId: string;
  anchor: SessionUserMessageAnchor | undefined;
  onJumpToAnchor: HistoryAnchorJumpHandler | undefined;
}): void {
  const { port, messageId, anchor, onJumpToAnchor } = options;
  port?.beginDeliberateJump();
  // Resident rows first. scrollToMessage() is false for short
  // (non-virtualized) transcripts and for ticks whose DOM node is already
  // mounted — those used to fall through to a Host window fetch.
  if (port?.scrollToMessage(messageId)) {
    return;
  }
  if (scrollTranscriptToMessage(messageId)) {
    port?.detachFromTail();
    return;
  }
  if (!anchor || !onJumpToAnchor) {
    return;
  }
  const settleJump = (): boolean =>
    Boolean(port?.scrollToMessage(messageId)) || scrollTranscriptToMessage(messageId);
  const jump = async (): Promise<void> => {
    await onJumpToAnchor(anchor);
    if (settleJump()) {
      return;
    }
    window.requestAnimationFrame(() => {
      if (settleJump()) {
        return;
      }
      window.requestAnimationFrame(() => {
        settleJump();
      });
    });
  };
  void jump().catch((error: unknown) => {
    console.error('history anchor jump failed', error);
  });
}
