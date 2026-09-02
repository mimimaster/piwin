/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listenMock } = vi.hoisted(() => ({
  listenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

describe('native Artifact bridge routing', () => {
  beforeEach(() => {
    vi.resetModules();
    listenMock.mockReset();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('retains an early size for its own channel while another frame is subscribed', async () => {
    const nativeListeners: Array<(event: { payload: unknown }) => void> = [];
    listenMock.mockImplementation(
      async (_eventName: string, listener: (event: { payload: unknown }) => void) => {
        nativeListeners.push(listener);
        return () => undefined;
      },
    );
    const { subscribeNativeArtifactBridge } = await import('./artifact-native-bridge.js');
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    await subscribeNativeArtifactBridge('frame-a', firstHandler);

    const secondSize = {
      type: 'piwin-artifact:size',
      channelId: 'frame-b',
      height: 436,
      viewportHeight: 80,
      revision: 0,
    };
    nativeListeners[0]?.({ payload: secondSize });

    expect(firstHandler).not.toHaveBeenCalled();
    await subscribeNativeArtifactBridge('frame-b', secondHandler);
    expect(secondHandler).toHaveBeenCalledOnce();
    expect(secondHandler).toHaveBeenCalledWith(secondSize);
  });

  it('does not replay stale user actions to a later subscriber', async () => {
    const nativeListeners: Array<(event: { payload: unknown }) => void> = [];
    listenMock.mockImplementation(
      async (_eventName: string, listener: (event: { payload: unknown }) => void) => {
        nativeListeners.push(listener);
        return () => undefined;
      },
    );
    const { subscribeNativeArtifactBridge } = await import('./artifact-native-bridge.js');
    nativeListeners[0]?.({
      payload: {
        type: 'piwin-artifact:action',
        channelId: 'frame-later',
        action: 'artifact/download-unsupported',
        payload: { filename: 'stale.txt' },
      },
    });
    const handler = vi.fn();
    await subscribeNativeArtifactBridge('frame-later', handler);
    expect(handler).not.toHaveBeenCalled();
  });
});
