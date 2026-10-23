/**
 * Conversation user-card copy/edit placement.
 *
 * One-line prompts keep the actions on the same row so they do not cover the
 * last words. Anything that cannot share that row (wrap, newline, chips,
 * collapse overflow) pins the actions to the bottom-right of the card.
 */

export const USER_MESSAGE_FOOTER_INLINE_RESERVE_PX = 88;

export function isUserMessageFooterOverlay(input: {
  text: string;
  hasShelfContent: boolean;
  isTextOverflow: boolean;
  unwrappedTextWidth: number;
  bubbleInnerWidth: number;
}): boolean {
  if (input.hasShelfContent || input.isTextOverflow) return true;
  if (input.text.includes('\n')) return true;
  // happy-dom and the first layout pass may report 0. Treat that as inline
  // unless a cheaper signal already forced overlay above.
  if (input.bubbleInnerWidth <= 0) return false;
  return input.unwrappedTextWidth + USER_MESSAGE_FOOTER_INLINE_RESERVE_PX > input.bubbleInnerWidth;
}

export function readBubbleInnerWidth(bubble: HTMLElement): number {
  const styles = getComputedStyle(bubble);
  const horizontalPadding =
    (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0);
  return Math.max(0, bubble.clientWidth - horizontalPadding);
}

export function measureUnwrappedTextWidth(node: HTMLElement): number {
  const sourceStyle = getComputedStyle(node);
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.whiteSpace = 'nowrap';
  probe.style.pointerEvents = 'none';
  probe.style.fontFamily = sourceStyle.fontFamily;
  probe.style.fontSize = sourceStyle.fontSize;
  probe.style.fontWeight = sourceStyle.fontWeight;
  probe.style.letterSpacing = sourceStyle.letterSpacing;
  probe.textContent = node.textContent ?? '';
  node.appendChild(probe);
  const width = probe.offsetWidth;
  probe.remove();
  return width;
}
