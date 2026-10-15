import { afterEach, describe, expect, it } from 'vitest';
import { shouldForceKeepArtifactHost } from './artifact-frame-lifecycle.js';
import {
  claimArtifactLiveHost,
  evictNonForceKeepArtifactHosts,
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

  it('protects live streaming and canvas while memory pressure recycles a completed preview', () => {
    const evicted: string[] = [];
    for (const [id, presentation, streaming] of [
      ['stream-live', 'inline', true],
      ['canvas-live', 'canvas', false],
      ['history-done', 'inline', false],
    ] as const) {
      claimArtifactLiveHost({ id, forceKeep: shouldForceKeepArtifactHost(presentation, streaming), evict: () => evicted.push(id) });
    }

    evictNonForceKeepArtifactHosts();
    expect(evicted).toEqual(['history-done']);
    expect(getLiveArtifactHostIdsForTests().sort()).toEqual(['canvas-live', 'stream-live']);
  });
});
