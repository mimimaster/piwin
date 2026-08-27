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
