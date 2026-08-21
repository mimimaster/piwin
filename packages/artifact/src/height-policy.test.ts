import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_BOOTSTRAP_HEIGHT,
  ARTIFACT_VIEWPORT_FILL_HEIGHT,
  MAX_ARTIFACT_INLINE_FLOW_HEIGHT,
  MIN_ARTIFACT_IFRAME_HEIGHT,
} from './constants.js';
import {
  clampArtifactHeight,
  normalizeArtifactHeight,
  stabilizeInlineArtifactHeight,
} from './height-policy.js';

describe('artifact height policy', () => {
  it('uses the bootstrap height only when no measurement exists', () => {
    expect(
      normalizeArtifactHeight(0, MIN_ARTIFACT_IFRAME_HEIGHT, ARTIFACT_BOOTSTRAP_HEIGHT),
    ).toBe(ARTIFACT_BOOTSTRAP_HEIGHT);
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
});

describe('stabilizeInlineArtifactHeight', () => {
  it('pins a viewport-tracking canvas to its budget plus natural siblings', () => {
    // Mount at bootstrap 80: canvas fills, root has 8px padding → 400 + 8.
    expect(
      stabilizeInlineArtifactHeight({
        measuredHeight: 88,
        viewportHeight: 80,
        sceneHeight: 80,
        lastReportedHeight: -1,
      }),
    ).toBe(ARTIFACT_VIEWPORT_FILL_HEIGHT + 8);
    // The iframe resized to 408; the canvas followed. Converged — no repost.
    expect(
      stabilizeInlineArtifactHeight({
        measuredHeight: 416,
        viewportHeight: 408,
        sceneHeight: 408,
        lastReportedHeight: ARTIFACT_VIEWPORT_FILL_HEIGHT + 8,
      }),
    ).toBeNull();
  });

  it('keeps sibling content below a viewport-tracking canvas measurable', () => {
    // canvas fills 80px viewport, 200px of text follows → budget + 200 + padding.
    expect(
      stabilizeInlineArtifactHeight({
        measuredHeight: 288,
        viewportHeight: 80,
        sceneHeight: 80,
        lastReportedHeight: -1,
      }),
    ).toBe(ARTIFACT_VIEWPORT_FILL_HEIGHT + 208);
  });

  it('upgrades a stream-final scene that was measured while scripts were inert', () => {
    // Streaming reported the default 150px canvas (158 with padding); at final
    // the activated script starts tracking innerHeight → one upgrade post.
    expect(
      stabilizeInlineArtifactHeight({
        measuredHeight: 166,
        viewportHeight: 158,
        sceneHeight: 158,
        lastReportedHeight: 158,
      }),
    ).toBe(ARTIFACT_VIEWPORT_FILL_HEIGHT + 8);
  });

  it('still reports content that is taller than the current iframe', () => {
    expect(
      stabilizeInlineArtifactHeight({
        measuredHeight: 720,
        viewportHeight: 80,
        sceneHeight: 0,
        lastReportedHeight: -1,
      }),
    ).toBe(720);
  });

  it('does not inflate a compact widget that happens to match bootstrap height', () => {
    expect(
      stabilizeInlineArtifactHeight({
        measuredHeight: 80,
        viewportHeight: 80,
        sceneHeight: 0,
        lastReportedHeight: -1,
      }),
    ).toBe(80);
  });

  it('freezes a viewport-filling wrapper after the first report', () => {
    expect(
      stabilizeInlineArtifactHeight({
        measuredHeight: 96,
        viewportHeight: 88,
        sceneHeight: 0,
        lastReportedHeight: 88,
      }),
    ).toBeNull();
  });
});
