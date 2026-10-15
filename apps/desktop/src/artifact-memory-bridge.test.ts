import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimArtifactLiveHost,
  getLiveArtifactHostIdsForTests,
  resetArtifactLiveHostRegistryForTests,
} from './artifact-live-host-registry.js';
import {
  installArtifactMemoryBridge,
  uninstallArtifactMemoryBridge,
} from './artifact-memory-bridge';
import { globalMemoryGovernor } from './memory-governor';

describe('artifact memory bridge', () => {
  afterEach(() => {
    uninstallArtifactMemoryBridge();
    globalMemoryGovernor.reset();
    resetArtifactLiveHostRegistryForTests();
  });

  it('evicts non-forceKeep hosts on critical and does not remount on recovery', () => {
    const evicted: string[] = [];
    claimArtifactLiveHost({
      id: 'plain-a',
      evict: () => {
        evicted.push('plain-a');
      },
    });
    claimArtifactLiveHost({
      id: 'plain-b',
      evict: () => {
        evicted.push('plain-b');
      },
    });
    claimArtifactLiveHost({
      id: 'keep',
      forceKeep: true,
      evict: () => {
        evicted.push('keep');
      },
    });

    installArtifactMemoryBridge();
    globalMemoryGovernor.setLevel('moderate');
    expect(evicted).toEqual([]);
    expect(getLiveArtifactHostIdsForTests()).toEqual(
      expect.arrayContaining(['plain-a', 'plain-b', 'keep']),
    );

    globalMemoryGovernor.setLevel('critical');
    expect(evicted).toEqual(['plain-a', 'plain-b']);
    expect(getLiveArtifactHostIdsForTests()).toEqual(['keep']);

    globalMemoryGovernor.setLevel('normal');
    expect(getLiveArtifactHostIdsForTests()).toEqual(['keep']);
  });

  it('evicts immediately when installed while already critical', () => {
    const evict = vi.fn();
    claimArtifactLiveHost({ id: 'plain', evict });
    globalMemoryGovernor.setLevel('critical');
    installArtifactMemoryBridge();
    expect(evict).toHaveBeenCalledOnce();
    expect(getLiveArtifactHostIdsForTests()).toEqual([]);
  });

  it('holds new previews while critical and lets them mount again once pressure drops', () => {
    installArtifactMemoryBridge();
    globalMemoryGovernor.setLevel('critical');
    expect(claimArtifactLiveHost({ id: 'during', evict: () => undefined }).admitted).toBe(false);

    globalMemoryGovernor.setLevel('moderate');
    expect(claimArtifactLiveHost({ id: 'after', evict: () => undefined }).admitted).toBe(true);
    expect(getLiveArtifactHostIdsForTests()).toEqual(['after']);
  });
});
