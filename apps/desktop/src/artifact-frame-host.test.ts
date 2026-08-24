import { afterEach, describe, expect, it } from 'vitest';
import { shouldForceKeepArtifactHost } from './artifact-frame-lifecycle.js';
import {
  MAX_LIVE_ARTIFACT_IFRAMES,
  claimArtifactLiveHost,
  getLiveArtifactHostIdsForTests,
  resetArtifactLiveHostRegistryForTests,
} from './artifact-live-host-registry.js';

describe('shouldForceKeepArtifactHost', () => {
  it('keeps live streaming previews pinned so token updates cannot evict the iframe', () => {
    expect(shouldForceKeepArtifactHost('inline', true)).toBe(true);
  });

  it('keeps the canvas surface pinned so the open preview cannot be evicted', () => {
    expect(shouldForceKeepArtifactHost('canvas', false)).toBe(true);
    expect(shouldForceKeepArtifactHost('canvas', true)).toBe(true);
  });

  it('allows historical completed inline previews to be recycled', () => {
    expect(shouldForceKeepArtifactHost('inline', false)).toBe(false);
  });
});

describe('forceKeep live-host cases', () => {
  afterEach(() => {
    resetArtifactLiveHostRegistryForTests();
  });

  it('protects live streaming and canvas while recycling a completed preview', () => {
    const evicted: string[] = [];
    claimArtifactLiveHost({
      id: 'stream-live',
      forceKeep: shouldForceKeepArtifactHost('inline', true),
      priority: 1_000,
      evict: () => evicted.push('stream-live'),
    });
    claimArtifactLiveHost({
      id: 'canvas-live',
      forceKeep: shouldForceKeepArtifactHost('canvas', false),
      priority: 1_000,
      evict: () => evicted.push('canvas-live'),
    });
    claimArtifactLiveHost({
      id: 'history-done',
      forceKeep: shouldForceKeepArtifactHost('inline', false),
      priority: 100,
      evict: () => evicted.push('history-done'),
    });
    for (let index = 3; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      claimArtifactLiveHost({
        id: `pad-${index}`,
        forceKeep: false,
        priority: 50,
        evict: () => evicted.push(`pad-${index}`),
      });
    }

    const extra = claimArtifactLiveHost({
      id: 'newer-visible',
      forceKeep: false,
      priority: 200,
      evict: () => undefined,
    });
    expect(extra.admitted).toBe(true);
    expect(evicted).toContain('history-done');
    expect(evicted).not.toContain('stream-live');
    expect(evicted).not.toContain('canvas-live');
    expect(getLiveArtifactHostIdsForTests()).toContain('stream-live');
    expect(getLiveArtifactHostIdsForTests()).toContain('canvas-live');
    expect(getLiveArtifactHostIdsForTests()).not.toContain('history-done');
  });
});
