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

const MAX_CACHED_TEXT_WIDTHS = 500;
const textWidthCache = new Map<string, number>();
let measureContext: CanvasRenderingContext2D | null | undefined;

function canvasContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    try {
      measureContext = document.createElement('canvas').getContext('2d');
    } catch {
      // No 2D canvas (test DOMs): the DOM probe below measures instead.
      measureContext = null;
    }
  }
  return measureContext;
}

function measureWithProbe(node: HTMLElement, sourceStyle: CSSStyleDeclaration, text: string): number {
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
  probe.textContent = text;
  node.appendChild(probe);
  const width = probe.offsetWidth;
  probe.remove();
  return width;
}

/**
 * Width the prompt would take on one line. Text metrics from a 2D canvas:
 * the old in-DOM probe forced a layout per user message (append, read,
 * remove), which on opening a long session cost more than the rest of the
 * first render. Cached by font and text, so a remount measures nothing.
 */
export function measureUnwrappedTextWidth(node: HTMLElement): number {
  const sourceStyle = getComputedStyle(node);
  const text = node.textContent ?? '';
  const font = `${sourceStyle.fontStyle} ${sourceStyle.fontWeight} ${sourceStyle.fontSize} ${sourceStyle.fontFamily}`;
  const key = `${font}|${sourceStyle.letterSpacing}|${text}`;
  const cached = textWidthCache.get(key);
  if (cached !== undefined) return cached;
  const context = canvasContext();
  let width: number;
  if (context) {
    context.font = font;
    const letterSpacing = Number.parseFloat(sourceStyle.letterSpacing) || 0;
    width = Math.ceil(context.measureText(text).width + letterSpacing * Array.from(text).length);
  } else {
    width = measureWithProbe(node, sourceStyle, text);
  }
  textWidthCache.set(key, width);
  if (textWidthCache.size > MAX_CACHED_TEXT_WIDTHS) {
    const oldest = textWidthCache.keys().next().value;
    if (oldest !== undefined) textWidthCache.delete(oldest);
  }
  return width;
}
