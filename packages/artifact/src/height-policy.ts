/** Pure height normalization for Inline artifact iframes. */
import {
  ARTIFACT_INLINE_VIEWPORT_HEIGHT_VH,
  ARTIFACT_INLINE_VIEWPORT_MAX_HEIGHT,
  ARTIFACT_INLINE_VIEWPORT_MIN_HEIGHT,
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

/** Host chrome for inline-viewport / inline-overflow. Size still travels on the existing size message. */
export function resolveArtifactViewportFrameHeight(viewportHeight: number): number {
  const raw = viewportHeight * ARTIFACT_INLINE_VIEWPORT_HEIGHT_VH;
  return Math.round(
    Math.min(
      ARTIFACT_INLINE_VIEWPORT_MAX_HEIGHT,
      Math.max(ARTIFACT_INLINE_VIEWPORT_MIN_HEIGHT, raw),
    ),
  );
}
