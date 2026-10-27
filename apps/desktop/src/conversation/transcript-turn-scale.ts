/**
 * Whole-session coordinates for the floating scrollbar. The resident window
 * (live tail or a history view) is one stretch of the session's turns; the
 * scrollbar places that stretch among all turns and interpolates by pixels
 * inside it, so a thumb at the top means "first turn", not "top of the
 * rows that happen to be loaded".
 */

export type ResidentTurnSpan = {
  /** Ordinal of the first resident user message among all session turns. */
  firstOrdinal: number;
  /** Resident user messages (turns) in the window. */
  count: number;
  /** User messages in the whole session. */
  total: number;
};

/** A scroll target: move pixels inside the window, or seek a turn outside it. */
export type TurnScrollTarget =
  | { kind: 'pixels'; scrollTop: number }
  | { kind: 'turn'; ordinal: number };

export type TurnScrollThumb = {
  /** Thumb top as a percentage of the track. */
  topPct: number;
  heightPct: number;
};

export const MIN_TURN_SCROLL_THUMB_PCT = 8;

/**
 * Where the resident window sits. `null` falls back to plain pixel scrolling:
 * no index yet, an older Host without page ordinals, or nothing to place.
 */
export function resolveResidentTurnSpan(input: {
  totalUserMessages: number | null;
  residentUserMessages: number;
  /** Known for a history view (Host page ordinal); the live tail ends the session. */
  historyFirstOrdinal: number | null | undefined;
  historyViewActive: boolean;
}): ResidentTurnSpan | null {
  const { totalUserMessages, residentUserMessages } = input;
  if (totalUserMessages === null || residentUserMessages === 0) return null;
  // A just-sent turn can be resident before the index counts it.
  const total = Math.max(totalUserMessages, residentUserMessages);
  if (input.historyViewActive) {
    if (typeof input.historyFirstOrdinal !== 'number') return null;
    const firstOrdinal = Math.min(Math.max(input.historyFirstOrdinal, 0), total - 1);
    return { firstOrdinal, count: Math.min(residentUserMessages, total - firstOrdinal), total };
  }
  return { firstOrdinal: total - residentUserMessages, count: residentUserMessages, total };
}

/** True when every turn is resident: the pixel scrollbar is already exact. */
export function isWholeSessionResident(span: ResidentTurnSpan | null): boolean {
  return span === null || (span.firstOrdinal === 0 && span.count >= span.total);
}

/**
 * Thumb geometry. Pixel progress inside the window becomes a turn position;
 * the thumb covers the visible share of the window's turns.
 */
export function computeTurnScrollThumb(input: {
  span: ResidentTurnSpan | null;
  /** clientHeight / scrollHeight of the resident window. */
  scrollRatio: number;
  /** scrollTop / (scrollHeight - clientHeight), 0..1. */
  scrollProgress: number;
}): TurnScrollThumb {
  const { span } = input;
  const windowShare = span ? span.count / span.total : 1;
  const heightPct = Math.max(MIN_TURN_SCROLL_THUMB_PCT, input.scrollRatio * windowShare * 100);
  const progress = span
    ? (span.firstOrdinal + clampUnit(input.scrollProgress) * span.count) / span.total
    : clampUnit(input.scrollProgress);
  return { topPct: clampUnit(progress) * (100 - heightPct), heightPct };
}

/**
 * Track fraction (0 = top, 1 = bottom) → target. Inside the resident turns
 * the window scrolls by pixels; outside, the caller seeks a turn.
 */
export function resolveTurnScrollTarget(input: {
  span: ResidentTurnSpan | null;
  fraction: number;
  maxScrollTop: number;
}): TurnScrollTarget {
  const fraction = clampUnit(input.fraction);
  const { span } = input;
  if (isWholeSessionResident(span) || span === null) {
    return { kind: 'pixels', scrollTop: fraction * input.maxScrollTop };
  }
  const position = fraction * span.total;
  const windowEnd = span.firstOrdinal + span.count;
  // The live tail reaches the session end; a history view may not.
  const reachesEnd = windowEnd >= span.total;
  if (position >= span.firstOrdinal && (position <= windowEnd || reachesEnd)) {
    const local = span.count === 0 ? 1 : (position - span.firstOrdinal) / span.count;
    return { kind: 'pixels', scrollTop: clampUnit(local) * input.maxScrollTop };
  }
  return { kind: 'turn', ordinal: Math.min(Math.floor(position), span.total - 1) };
}

/** Turn ordinal under a track fraction, for the drag label. */
export function turnOrdinalAtFraction(span: ResidentTurnSpan, fraction: number): number {
  return Math.min(Math.floor(clampUnit(fraction) * span.total), span.total - 1);
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

/** Index anchor whose span holds a turn, else the nearest by ordinal. Anchors are ordinal-sorted. */
export function findTurnAnchor<Anchor extends { ordinal: number; spanStartOrdinal: number; spanEndOrdinal: number }>(
  anchors: readonly Anchor[],
  ordinal: number,
): Anchor | null {
  let low = 0;
  let high = anchors.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const anchor = anchors[middle];
    if (!anchor) return null;
    if (ordinal < anchor.spanStartOrdinal) high = middle - 1;
    else if (ordinal > anchor.spanEndOrdinal) low = middle + 1;
    else return anchor;
  }
  const before = anchors[high];
  const after = anchors[low];
  if (!before) return after ?? null;
  if (!after) return before;
  return ordinal - before.spanEndOrdinal <= after.spanStartOrdinal - ordinal ? before : after;
}
