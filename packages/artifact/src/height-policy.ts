/**
 * Pure one-shot height normalization for artifact iframes.
 */

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
