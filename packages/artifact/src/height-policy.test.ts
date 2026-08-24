import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_BOOTSTRAP_HEIGHT,
  ARTIFACT_INLINE_VIEWPORT_MAX_HEIGHT,
  ARTIFACT_INLINE_VIEWPORT_MIN_HEIGHT,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
} from './constants.js';
import {
  clampArtifactHeight,
  normalizeArtifactHeight,
  resolveArtifactViewportFrameHeight,
} from './height-policy.js';

describe('artifact height policy', () => {
  it('uses the bootstrap height only when no measurement exists', () => {
    expect(normalizeArtifactHeight(0, MIN_ARTIFACT_IFRAME_HEIGHT, ARTIFACT_BOOTSTRAP_HEIGHT)).toBe(
      ARTIFACT_BOOTSTRAP_HEIGHT,
    );
  });

  it('clamps tiny and runaway measurements', () => {
    expect(
      clampArtifactHeight(
        12,
        MIN_ARTIFACT_IFRAME_HEIGHT,
        MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
        ARTIFACT_BOOTSTRAP_HEIGHT,
      ),
    ).toBe(MIN_ARTIFACT_IFRAME_HEIGHT);
    expect(
      clampArtifactHeight(
        MAX_ARTIFACT_INLINE_FLOW_HEIGHT * 2,
        MIN_ARTIFACT_IFRAME_HEIGHT,
        MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
        ARTIFACT_BOOTSTRAP_HEIGHT,
      ),
    ).toBe(MAX_ARTIFACT_INLINE_FLOW_HEIGHT);
  });

  it('clamps host viewport chrome to 360–760 around 72vh', () => {
    expect(resolveArtifactViewportFrameHeight(500)).toBe(ARTIFACT_INLINE_VIEWPORT_MIN_HEIGHT);
    expect(resolveArtifactViewportFrameHeight(1_000)).toBe(720);
    expect(resolveArtifactViewportFrameHeight(2_000)).toBe(ARTIFACT_INLINE_VIEWPORT_MAX_HEIGHT);
  });
});
