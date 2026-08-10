/**
 * Pure policy for when an Inline Artifact may drop its sandboxed iframe.
 * Canvas and active stream-preview always host; off-screen frames recycle
 * only after the configured TTL so brief scroll-through does not thrash.
 *
 * Fail-open: unknown visibility always hosts. Recycle only when we have a
 * positive "not intersecting" signal for the full TTL — never blank a frame
 * the user is still looking at because of a flaky observer callback.
 */

export type ArtifactViewportHostIntent = 'host' | 'recycle';

export type ResolveArtifactViewportHostIntentInput = {
  presentation: 'inline' | 'canvas';
  /** Current evaluate mode; stream-preview must stay mounted for body updates. */
  renderMode: 'stream-preview' | 'interactive' | string;
  /**
   * IntersectionObserver result. `null` means unknown / no observer (fail-open
   * to host so tests and degraded environments still preview).
   */
  isIntersecting: boolean | null;
  /** ms since the frame last left the viewport; null while intersecting. */
  msSinceLeftViewport: number | null;
  recycleTtlMs: number;
};

/**
 * Decide whether the sandboxed iframe should be mounted.
 * - canvas: always host
 * - stream-preview: always host (postMessage body updates need a live window)
 * - no IO signal: host (fail-open)
 * - intersecting: host
 * - left viewport for >= TTL: recycle
 */
export function resolveArtifactViewportHostIntent(
  input: ResolveArtifactViewportHostIntentInput,
): ArtifactViewportHostIntent {
  if (input.presentation === 'canvas') {
    return 'host';
  }
  if (input.renderMode === 'stream-preview') {
    return 'host';
  }
  if (input.isIntersecting === null) {
    return 'host';
  }
  if (input.isIntersecting) {
    return 'host';
  }
  const elapsed = input.msSinceLeftViewport ?? 0;
  if (elapsed >= input.recycleTtlMs) {
    return 'recycle';
  }
  return 'host';
}

export type RectLike = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

/**
 * Geometry re-check used right before recycle. Expands the root by rootMarginY
 * (px) so near-viewport frames stay hosted. Returns true when any overlap.
 */
export function isRectNearRoot(
  target: RectLike,
  root: RectLike,
  rootMarginYPx: number,
): boolean {
  const expandedTop = root.top - rootMarginYPx;
  const expandedBottom = root.bottom + rootMarginYPx;
  return target.bottom > expandedTop && target.top < expandedBottom;
}

/** Parse the vertical component of a CSS rootMargin like `240px 0px`. */
export function parseRootMarginYPx(rootMargin: string): number {
  const first = rootMargin.trim().split(/\s+/)[0] ?? '0';
  const match = /^(-?\d+(?:\.\d+)?)px$/.exec(first);
  if (!match?.[1]) {
    return 0;
  }
  return Math.abs(Number(match[1]));
}
