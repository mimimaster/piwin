import { afterEach, describe, expect, it } from 'vitest';
import {
  claimArtifactLiveHost,
  evictNonForceKeepArtifactHosts,
  getLiveArtifactHostCount,
  getLiveArtifactHostIdsForTests,
  releaseArtifactLiveHost,
  requestArtifactLiveHost,
  resetArtifactLiveHostRegistryForTests,
  setArtifactHostPressureHold,
} from './artifact-live-host-registry.js';

function claim(id: string, forceKeep = false, evicted: string[] = []): { admitted: boolean } {
  return claimArtifactLiveHost({ id, forceKeep, evict: () => evicted.push(id) });
}

describe('artifact live host registry', () => {
  afterEach(() => {
    resetArtifactLiveHostRegistryForTests();
  });

  it('admits every preview: there is no count budget', () => {
    const evicted: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      expect(claim(`frame-${index}`, false, evicted).admitted).toBe(true);
    }
    expect(getLiveArtifactHostCount()).toBe(40);
    expect(evicted).toEqual([]);
  });

  it('critical pressure evicts every unpinned host and keeps streaming / canvas', () => {
    const evicted: string[] = [];
    claim('stream', true, evicted);
    claim('canvas', true, evicted);
    claim('history-a', false, evicted);
    claim('history-b', false, evicted);
    expect(evictNonForceKeepArtifactHosts()).toBe(2);
    expect(evicted.sort()).toEqual(['history-a', 'history-b']);
    expect(getLiveArtifactHostIdsForTests().sort()).toEqual(['canvas', 'stream']);
  });

  it('holds new unpinned previews while pressure is critical, but not pinned ones', () => {
    evictNonForceKeepArtifactHosts();
    expect(claim('new-history').admitted).toBe(false);
    expect(claim('new-stream', true).admitted).toBe(true);
    expect(getLiveArtifactHostIdsForTests()).toEqual(['new-stream']);
  });

  it('keeps a host that is already live when it re-claims under pressure', () => {
    claim('pinned', true);
    evictNonForceKeepArtifactHosts();
    // Streaming finished: the same frame re-claims unpinned and keeps its iframe.
    expect(claim('pinned', false).admitted).toBe(true);
  });

  it('Load preview mounts even while pressure holds', () => {
    evictNonForceKeepArtifactHosts();
    expect(requestArtifactLiveHost({ id: 'clicked', evict: () => undefined }).admitted).toBe(true);
    expect(getLiveArtifactHostIdsForTests()).toEqual(['clicked']);
  });

  it('lifting the hold admits new previews and remounts nothing by itself', () => {
    const evicted: string[] = [];
    claim('old', false, evicted);
    evictNonForceKeepArtifactHosts();
    setArtifactHostPressureHold(false);
    expect(getLiveArtifactHostIdsForTests()).toEqual([]);
    expect(claim('fresh').admitted).toBe(true);
    expect(evicted).toEqual(['old']);
  });

  it('release forgets the host', () => {
    claim('a');
    releaseArtifactLiveHost('a');
    expect(getLiveArtifactHostCount()).toBe(0);
  });
});
