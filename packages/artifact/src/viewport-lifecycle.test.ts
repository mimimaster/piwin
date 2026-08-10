import { describe, expect, it } from 'vitest';
import { ARTIFACT_VIEWPORT_RECYCLE_TTL_MS } from './constants.js';
import {
  isRectNearRoot,
  parseRootMarginYPx,
  resolveArtifactViewportHostIntent,
} from './viewport-lifecycle.js';

describe('resolveArtifactViewportHostIntent', () => {
  const ttl = ARTIFACT_VIEWPORT_RECYCLE_TTL_MS;

  it('always hosts canvas presentation', () => {
    expect(
      resolveArtifactViewportHostIntent({
        presentation: 'canvas',
        renderMode: 'interactive',
        isIntersecting: false,
        msSinceLeftViewport: ttl * 2,
        recycleTtlMs: ttl,
      }),
    ).toBe('host');
  });

  it('always hosts active stream-preview even when off-screen', () => {
    expect(
      resolveArtifactViewportHostIntent({
        presentation: 'inline',
        renderMode: 'stream-preview',
        isIntersecting: false,
        msSinceLeftViewport: ttl * 2,
        recycleTtlMs: ttl,
      }),
    ).toBe('host');
  });

  it('fail-opens to host when IntersectionObserver has no signal', () => {
    expect(
      resolveArtifactViewportHostIntent({
        presentation: 'inline',
        renderMode: 'interactive',
        isIntersecting: null,
        msSinceLeftViewport: null,
        recycleTtlMs: ttl,
      }),
    ).toBe('host');
  });

  it('hosts while intersecting', () => {
    expect(
      resolveArtifactViewportHostIntent({
        presentation: 'inline',
        renderMode: 'interactive',
        isIntersecting: true,
        msSinceLeftViewport: null,
        recycleTtlMs: ttl,
      }),
    ).toBe('host');
  });

  it('keeps host during TTL grace after leaving the viewport', () => {
    expect(
      resolveArtifactViewportHostIntent({
        presentation: 'inline',
        renderMode: 'interactive',
        isIntersecting: false,
        msSinceLeftViewport: ttl - 1,
        recycleTtlMs: ttl,
      }),
    ).toBe('host');
  });

  it('recycles after leaving the viewport for the full TTL', () => {
    expect(
      resolveArtifactViewportHostIntent({
        presentation: 'inline',
        renderMode: 'interactive',
        isIntersecting: false,
        msSinceLeftViewport: ttl,
        recycleTtlMs: ttl,
      }),
    ).toBe('recycle');
  });

  it('detects near-root geometry with vertical margin', () => {
    const root = { top: 100, right: 500, bottom: 700, left: 0 };
    // Just above the root, inside 240px overscan.
    expect(
      isRectNearRoot({ top: -100, right: 400, bottom: 50, left: 0 }, root, 240),
    ).toBe(true);
    // Far above — should recycle.
    expect(
      isRectNearRoot({ top: -800, right: 400, bottom: -600, left: 0 }, root, 240),
    ).toBe(false);
  });

  it('parses rootMargin Y from CSS margin strings', () => {
    expect(parseRootMarginYPx('240px 0px')).toBe(240);
    expect(parseRootMarginYPx('0px')).toBe(0);
  });
});
