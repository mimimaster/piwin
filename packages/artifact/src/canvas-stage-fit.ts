/**
 * Canvas host fit policy. The iframe is the design viewport; model HTML often
 * locks a phone/poster box and leaves empty panel chrome. Decide whether to
 * expand that box or scale it up. Distortion-free: fill-viewport reflows a
 * letterboxed poster; contain-scale grows a card that is small on both axes.
 */

export type CanvasStageFitAction = 'none' | 'fill-viewport' | 'contain-scale';

export type CanvasStageFitDecision = {
  action: CanvasStageFitAction;
  scale: number;
};

export type CanvasStageFitCandidate<T> = {
  id: T;
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
};

export const CANVAS_FIT_MIN_VIEWPORT_PX = 32;
export const CANVAS_FIT_MIN_CONTENT_PX = 8;
export const CANVAS_FIT_FILLS_RATIO = 0.92;
export const CANVAS_FIT_POSTER_HEIGHT_RATIO = 0.72;
export const CANVAS_FIT_UNUSED_RATIO = 0.88;
export const CANVAS_FIT_OVERFLOW_SLACK_PX = 8;
export const CANVAS_FIT_SCALE_EPSILON = 1.02;
export const CANVAS_FIT_MAX_SCALE = 4;
/**
 * A cover-cropped design box (`preserveAspectRatio="...slice"`) may hide this
 * much of the declared viewBox before the canvas shows the whole box instead.
 */
export const CANVAS_FIT_COVER_MIN_VISIBLE_RATIO = 0.7;

export function resolveCanvasStageFit(input: {
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
}): CanvasStageFitDecision {
  const viewportWidth = input.viewportWidth;
  const viewportHeight = input.viewportHeight;
  const contentWidth = input.contentWidth;
  const contentHeight = input.contentHeight;
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(contentWidth) ||
    !Number.isFinite(contentHeight)
  ) {
    return { action: 'none', scale: 1 };
  }
  if (
    viewportWidth < CANVAS_FIT_MIN_VIEWPORT_PX ||
    viewportHeight < CANVAS_FIT_MIN_VIEWPORT_PX ||
    contentWidth < CANVAS_FIT_MIN_CONTENT_PX ||
    contentHeight < CANVAS_FIT_MIN_CONTENT_PX
  ) {
    return { action: 'none', scale: 1 };
  }

  const widthRatio = contentWidth / viewportWidth;
  const heightRatio = contentHeight / viewportHeight;
  const fillsWidth = widthRatio >= CANVAS_FIT_FILLS_RATIO;
  const fillsHeight = heightRatio >= CANVAS_FIT_POSTER_HEIGHT_RATIO;
  const unusedWidth = widthRatio <= CANVAS_FIT_UNUSED_RATIO;
  const unusedHeight = heightRatio <= CANVAS_FIT_UNUSED_RATIO;
  const overflowsHeight = contentHeight > viewportHeight + CANVAS_FIT_OVERFLOW_SLACK_PX;

  // Tall document already using the column — leave scroll alone.
  if (fillsWidth && overflowsHeight) {
    return { action: 'none', scale: 1 };
  }

  // Portrait phone/poster: uses the panel height and letterboxes the sides.
  if (fillsHeight && unusedWidth) {
    return { action: 'fill-viewport', scale: 1 };
  }

  // Small card sitting in a larger panel — grow it uniformly.
  if (unusedWidth && unusedHeight) {
    const scale = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight);
    if (scale > CANVAS_FIT_SCALE_EPSILON) {
      return { action: 'contain-scale', scale: Math.min(scale, CANVAS_FIT_MAX_SCALE) };
    }
  }

  return { action: 'none', scale: 1 };
}

export function pickCanvasStageFit<T>(
  candidates: readonly CanvasStageFitCandidate<T>[],
): { id: T; decision: CanvasStageFitDecision } | null {
  let best: { id: T; decision: CanvasStageFitDecision; rank: number } | null = null;
  for (const candidate of candidates) {
    const decision = resolveCanvasStageFit(candidate);
    if (decision.action === 'none') continue;
    const widthRatio = candidate.contentWidth / Math.max(1, candidate.viewportWidth);
    const rank =
      decision.action === 'fill-viewport' ? 100 + (1 - widthRatio) : decision.scale;
    if (best === null || rank > best.rank) {
      best = { id: candidate.id, decision, rank };
    }
  }
  return best === null ? null : { id: best.id, decision: best.decision };
}

export type CanvasDesignBoxCorrection =
  | { action: 'none'; preserveAspectRatio: null }
  | { action: 'letterbox'; preserveAspectRatio: string };

export type CanvasDesignBoxCandidate<T> = {
  id: T;
  /** Rendered box of the SVG that paints the canvas surface. */
  boxWidth: number;
  boxHeight: number;
  /** Declared design box from the SVG viewBox. */
  designWidth: number;
  designHeight: number;
  preserveAspectRatio: string | null | undefined;
};

/**
 * An SVG that fills the canvas and cover-crops its own viewBox hides part of
 * the design (a 5:3 scene in a portrait panel shows ~37% of it). The canvas is
 * the design viewport, so the whole declared box stays visible: swap `slice`
 * for `meet` and keep the author's alignment.
 */
export function resolveCanvasDesignBoxCorrection(
  candidate: CanvasDesignBoxCandidate<unknown>,
): CanvasDesignBoxCorrection {
  const preserve = candidate.preserveAspectRatio ?? '';
  if (!/slice/i.test(preserve)) return { action: 'none', preserveAspectRatio: null };
  const { boxWidth, boxHeight, designWidth, designHeight } = candidate;
  if (![boxWidth, boxHeight, designWidth, designHeight].every((value) => Number.isFinite(value))) {
    return { action: 'none', preserveAspectRatio: null };
  }
  if (
    boxWidth < CANVAS_FIT_MIN_CONTENT_PX ||
    boxHeight < CANVAS_FIT_MIN_CONTENT_PX ||
    designWidth <= 0 ||
    designHeight <= 0
  ) {
    return { action: 'none', preserveAspectRatio: null };
  }
  const scale = Math.max(boxWidth / designWidth, boxHeight / designHeight);
  const visible =
    Math.min(1, boxWidth / (designWidth * scale)) * Math.min(1, boxHeight / (designHeight * scale));
  if (visible >= CANVAS_FIT_COVER_MIN_VISIBLE_RATIO) {
    return { action: 'none', preserveAspectRatio: null };
  }
  return { action: 'letterbox', preserveAspectRatio: preserve.replace(/slice/i, 'meet') };
}

/**
 * Picks the SVG to correct: it must paint the canvas surface (fills both axes)
 * rather than sit inline inside a larger document.
 */
export function pickCanvasDesignBoxCorrection<T>(
  input: {
    viewportWidth: number;
    viewportHeight: number;
    candidates: readonly CanvasDesignBoxCandidate<T>[];
  },
): { id: T; preserveAspectRatio: string } | null {
  if (
    input.viewportWidth < CANVAS_FIT_MIN_VIEWPORT_PX ||
    input.viewportHeight < CANVAS_FIT_MIN_VIEWPORT_PX
  ) {
    return null;
  }
  for (const candidate of input.candidates) {
    const fillsWidth = candidate.boxWidth / input.viewportWidth >= CANVAS_FIT_FILLS_RATIO;
    const fillsHeight = candidate.boxHeight / input.viewportHeight >= CANVAS_FIT_FILLS_RATIO;
    if (!fillsWidth || !fillsHeight) continue;
    const correction = resolveCanvasDesignBoxCorrection(candidate);
    if (correction.action === 'letterbox') {
      return { id: candidate.id, preserveAspectRatio: correction.preserveAspectRatio };
    }
  }
  return null;
}
