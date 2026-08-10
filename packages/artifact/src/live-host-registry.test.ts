import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_LIVE_ARTIFACT_IFRAMES,
  claimArtifactLiveHost,
  getLiveArtifactHostCount,
  getLiveArtifactHostIdsForTests,
  getWaitingArtifactHostCount,
  getWaitingArtifactHostIdsForTests,
  releaseArtifactLiveHost,
  requestArtifactLiveHost,
  resetArtifactLiveHostRegistryForTests,
  touchArtifactLiveHost,
} from './live-host-registry.js';

describe('artifact live host registry', () => {
  afterEach(() => {
    resetArtifactLiveHostRegistryForTests();
  });

  it('admits up to the hard cap', () => {
    for (let index = 0; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      const result = claimArtifactLiveHost({
        id: `a${index}`,
        priority: 10,
        evict: () => undefined,
      });
      expect(result.admitted).toBe(true);
    }
    expect(getLiveArtifactHostCount()).toBe(MAX_LIVE_ARTIFACT_IFRAMES);
  });

  it('evicts the lowest-priority host when a new one claims', () => {
    const evicted: string[] = [];
    claimArtifactLiveHost({
      id: 'old-low',
      priority: 1,
      evict: () => {
        evicted.push('old-low');
      },
    });
    claimArtifactLiveHost({
      id: 'old-high',
      priority: 50,
      evict: () => {
        evicted.push('old-high');
      },
    });
    for (let index = 2; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      claimArtifactLiveHost({
        id: `pad-${index}`,
        priority: 40,
        evict: () => {
          evicted.push(`pad-${index}`);
        },
      });
    }

    const result = claimArtifactLiveHost({
      id: 'new',
      priority: 80,
      evict: () => undefined,
    });
    expect(result.admitted).toBe(true);
    expect(evicted).toContain('old-low');
    expect(evicted).not.toContain('old-high');
    expect(getLiveArtifactHostIdsForTests()).toContain('new');
    expect(getLiveArtifactHostIdsForTests()).not.toContain('old-low');
  });

  it('queues a denied claim and re-admits when a slot frees', () => {
    const onAdmit = vi.fn();
    // forceKeep fills the cap so a plain claim cannot evict and must wait.
    for (let index = 0; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      claimArtifactLiveHost({
        id: `keep-${index}`,
        forceKeep: true,
        priority: 100,
        evict: () => undefined,
      });
    }
    const denied = claimArtifactLiveHost({
      id: 'waiter',
      priority: 10,
      evict: () => undefined,
      onAdmit,
    });
    expect(denied.admitted).toBe(false);
    expect(getWaitingArtifactHostCount()).toBe(1);
    expect(getWaitingArtifactHostIdsForTests()).toContain('waiter');

    releaseArtifactLiveHost('keep-0');
    expect(onAdmit).toHaveBeenCalledTimes(1);
    expect(getLiveArtifactHostIdsForTests()).toContain('waiter');
    expect(getWaitingArtifactHostCount()).toBe(0);
  });

  it('never evicts forceKeep hosts for budget (can exceed soft intent)', () => {
    const evicted: string[] = [];
    for (let index = 0; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      claimArtifactLiveHost({
        id: `force-${index}`,
        forceKeep: true,
        priority: 1,
        evict: () => {
          evicted.push(`force-${index}`);
        },
      });
    }
    const result = claimArtifactLiveHost({
      id: 'extra-force',
      forceKeep: true,
      priority: 1,
      evict: () => undefined,
    });
    expect(result.admitted).toBe(true);
    expect(evicted).toEqual([]);
    expect(getLiveArtifactHostCount()).toBe(MAX_LIVE_ARTIFACT_IFRAMES + 1);
  });

  it('rejects non-force claims when only forceKeep hosts occupy the cap', () => {
    for (let index = 0; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      claimArtifactLiveHost({
        id: `force-${index}`,
        forceKeep: true,
        priority: 1,
        evict: () => undefined,
      });
    }
    const result = claimArtifactLiveHost({
      id: 'plain',
      priority: 100,
      evict: () => undefined,
    });
    expect(result.admitted).toBe(false);
    expect(getLiveArtifactHostIdsForTests()).not.toContain('plain');
    expect(getWaitingArtifactHostIdsForTests()).toContain('plain');
  });

  it('requestArtifactLiveHost can evict a lower-priority live host', () => {
    claimArtifactLiveHost({
      id: 'low',
      priority: 1,
      evict: () => undefined,
    });
    for (let index = 1; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      claimArtifactLiveHost({
        id: `mid-${index}`,
        priority: 20,
        evict: () => undefined,
      });
    }
    const result = requestArtifactLiveHost({
      id: 'click',
      priority: 10,
      evict: () => undefined,
    });
    expect(result.admitted).toBe(true);
    expect(getLiveArtifactHostIdsForTests()).toContain('click');
    expect(getLiveArtifactHostIdsForTests()).not.toContain('low');
  });

  it('touch updates priority used for later eviction', () => {
    const evicted: string[] = [];
    claimArtifactLiveHost({
      id: 'a',
      priority: 10,
      evict: () => {
        evicted.push('a');
      },
    });
    claimArtifactLiveHost({
      id: 'b',
      priority: 10,
      evict: () => {
        evicted.push('b');
      },
    });
    touchArtifactLiveHost('a', { priority: 1 });
    for (let index = 2; index < MAX_LIVE_ARTIFACT_IFRAMES; index += 1) {
      claimArtifactLiveHost({
        id: `pad-${index}`,
        priority: 50,
        evict: () => undefined,
      });
    }
    claimArtifactLiveHost({
      id: 'c',
      priority: 100,
      evict: () => undefined,
    });
    expect(evicted).toContain('a');
  });

  it('release frees a slot for the next claim', () => {
    claimArtifactLiveHost({ id: 'a', priority: 1, evict: () => undefined });
    claimArtifactLiveHost({ id: 'b', priority: 1, evict: () => undefined });
    releaseArtifactLiveHost('a');
    const result = claimArtifactLiveHost({ id: 'c', priority: 1, evict: () => undefined });
    expect(result.admitted).toBe(true);
    expect(getLiveArtifactHostIdsForTests()).toEqual(expect.arrayContaining(['b', 'c']));
    expect(getLiveArtifactHostIdsForTests()).not.toContain('a');
  });
});
