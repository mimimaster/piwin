/**
 * Pure one-shot height normalization for artifact iframes.
 */

import {
  ARTIFACT_VIEWPORT_FILL_HEIGHT,
  ARTIFACT_VIEWPORT_FILL_SLACK_PX,
} from './constants.js';

export function normalizeArtifactHeight(
  height: number,
  minHeight: number,
  bootstrapHeight: number,
): number {
  return Math.max(minHeight, Math.ceil(height || bootstrapHeight));
}

/** Clamp measured height into [minHeight, maxHeight]. */
export function clampArtifactHeight(
  height: number,
  minHeight: number,
  maxHeight: number,
  bootstrapHeight: number,
): number {
  const normalized = normalizeArtifactHeight(height, minHeight, bootstrapHeight);
  return Math.min(maxHeight, normalized);
}

export type StabilizeInlineArtifactHeightInput = {
  measuredHeight: number;
  viewportHeight: number;
  /** Box height of a canvas/video scene; 0 when the document has none. */
  sceneHeight: number;
  /** Previous posted height, or -1 before the first report. */
  lastReportedHeight: number;
};

/**
 * Break the iframe ↔ `window.innerHeight` feedback loop used by full-page
 * canvas animations. A scene that merely fills the current viewport is not
 * asking for more room: it gets a fixed height budget while sibling content
 * keeps its natural height (the non-scene remainder is viewport-independent,
 * so the reported value converges instead of ratcheting).
 * Returns null when the current measurement should not be posted.
 */
export function stabilizeInlineArtifactHeight(
  input: StabilizeInlineArtifactHeightInput,
): number | null {
  const measured = Math.max(0, Math.ceil(input.measuredHeight || 0));
  const viewport = Math.max(0, Math.ceil(input.viewportHeight || 0));
  const scene = Math.max(0, Math.ceil(input.sceneHeight || 0));
  const slack = ARTIFACT_VIEWPORT_FILL_SLACK_PX;
  const fills = (size: number): boolean =>
    viewport > 0 && size >= viewport - 1 && size <= viewport + slack;

  let height = measured;
  if (fills(scene)) {
    height = Math.max(0, measured - scene) + ARTIFACT_VIEWPORT_FILL_HEIGHT;
  } else if (input.lastReportedHeight >= 0 && fills(measured)) {
    return null;
  }
  return height === input.lastReportedHeight ? null : height;
}
