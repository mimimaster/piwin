import type { ArtifactFrameMode } from './types.js';

/**
 * Runtime frameMode may only upgrade from flow. Viewport, overflow, and
 * canvas never go backward; canvas cannot mix with inline modes.
 */
export function advanceArtifactFrameMode(
  current: ArtifactFrameMode,
  requested: ArtifactFrameMode,
): ArtifactFrameMode {
  if (current === requested) {
    return current;
  }
  if (current === 'canvas' || requested === 'canvas') {
    return current;
  }
  if (
    current === 'inline-flow' &&
    (requested === 'inline-viewport' || requested === 'inline-overflow')
  ) {
    return requested;
  }
  return current;
}
