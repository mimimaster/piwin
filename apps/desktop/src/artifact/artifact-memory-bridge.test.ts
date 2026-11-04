import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimArtifactLiveHost,
  resetArtifactLiveHostRegistryForTests,
} from './artifact-live-host-registry.js';
import {
  installArtifactMemoryBridge,
  uninstallArtifactMemoryBridge,
} from './artifact-memory-bridge.js';
import { globalMemoryGovernor } from '../notes/memory-governor.js';
import { sessionRenderResources } from '../session/session-render-resources.js';

describe('inactive-only Artifact memory bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    uninstallArtifactMemoryBridge();
    globalMemoryGovernor.reset();
    sessionRenderResources.reset();
    resetArtifactLiveHostRegistryForTests();
    vi.useRealTimers();
  });
  it('keeps current previews mounted during critical pressure and releases only inactive resources', async () => {
    const current = vi.fn();
    const oldCanvas = vi.fn();
    sessionRenderResources.setVisible(['current']);
    sessionRenderResources.register('current', current);
    sessionRenderResources.register('old', oldCanvas);
    installArtifactMemoryBridge();
    globalMemoryGovernor.setLevel('critical');
    expect(current).not.toHaveBeenCalled();
    expect(oldCanvas).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(current).not.toHaveBeenCalled();
    expect(oldCanvas).toHaveBeenCalledOnce();
    expect(claimArtifactLiveHost({ id: 'new-current-preview', evict: current }).admitted).toBe(
      true,
    );
  });
  it('does not recycle the just-restored session when pressure changes before idle', async () => {
    const old = vi.fn();
    const current = vi.fn();
    sessionRenderResources.setVisible(['first']);
    sessionRenderResources.register('first', old);
    sessionRenderResources.register('second', current);
    installArtifactMemoryBridge();
    globalMemoryGovernor.setLevel('moderate');
    sessionRenderResources.setVisible(['second']);
    globalMemoryGovernor.setLevel('critical');
    await vi.advanceTimersByTimeAsync(0);
    expect(old).toHaveBeenCalledOnce();
    expect(current).not.toHaveBeenCalled();
  });
});
