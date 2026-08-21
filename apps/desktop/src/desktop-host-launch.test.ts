// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearDesktopHostLaunchMode,
  loadDesktopHostLaunchMode,
  resolveDesktopHostResolutionWith,
  saveDesktopHostLaunchMode,
} from './desktop-host-launch';

describe('desktop host launch mode', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('defaults to undecided when nothing is saved', () => {
    expect(loadDesktopHostLaunchMode()).toBeUndefined();
    expect(
      resolveDesktopHostResolutionWith(
        () => undefined,
        () => undefined,
      ),
    ).toEqual({ kind: 'undecided' });
  });

  it('prefers a saved remote target over launch mode', () => {
    saveDesktopHostLaunchMode('sidecar');
    expect(
      resolveDesktopHostResolutionWith(
        () => ({ endpoint: 'ws://127.0.0.1:8787' }),
        loadDesktopHostLaunchMode,
      ),
    ).toEqual({
      kind: 'remote',
      target: { endpoint: 'ws://127.0.0.1:8787' },
    });
  });

  it('shows the attach wall when attach is chosen without a target', () => {
    saveDesktopHostLaunchMode('attach');
    expect(
      resolveDesktopHostResolutionWith(
        () => undefined,
        loadDesktopHostLaunchMode,
      ),
    ).toEqual({ kind: 'attach-wall' });
  });

  it('uses sidecar when chosen without a remote target', () => {
    saveDesktopHostLaunchMode('sidecar');
    expect(
      resolveDesktopHostResolutionWith(
        () => undefined,
        loadDesktopHostLaunchMode,
      ),
    ).toEqual({ kind: 'sidecar' });
  });

  it('forces the attach wall in a shell-only build', () => {
    saveDesktopHostLaunchMode('sidecar');
    expect(
      resolveDesktopHostResolutionWith(
        () => undefined,
        loadDesktopHostLaunchMode,
        true,
      ),
    ).toEqual({ kind: 'attach-wall' });
  });

  it('clears launch mode', () => {
    saveDesktopHostLaunchMode('attach');
    clearDesktopHostLaunchMode();
    expect(loadDesktopHostLaunchMode()).toBeUndefined();
  });
});
