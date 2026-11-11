import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserFrameNativeResourceReady } from '@piwin/contracts';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { openBrowserFrameNativeStream } from './browser-frame-native-stream.js';

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  readyListener: undefined as ((event: { payload: BrowserFrameNativeResourceReady }) => void) | undefined,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({ listen: bridge.listen }));

describe('openBrowserFrameNativeStream', () => {
  beforeEach(() => {
    bridge.readyListener = undefined;
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'browser_frame_stream_open') {
        return {
          version: 1,
          streamId: 's1',
          resourceUrlBase: 'piwin-frame://localhost/v1/s1',
          maxPacketBytes: 12 * 1024 * 1024,
        };
      }
      return undefined;
    });
    vi.mocked(listen).mockReset();
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      bridge.readyListener = handler as (event: { payload: BrowserFrameNativeResourceReady }) => void;
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches one delivery at a time and keeps only the newest ready notification', async () => {
    let resolveBody: ((body: ArrayBuffer) => void) | undefined;
    const firstBody = new Promise<ArrayBuffer>((resolve) => { resolveBody = resolve; });
    const firstResponse = {
      ok: true,
      status: 200,
      arrayBuffer: () => firstBody,
    } as Response;
    const laterResponse = {
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array([9]).buffer,
    } as Response;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValue(laterResponse);
    vi.stubGlobal('fetch', fetchMock);
    const frames: number[][] = [];
    const errors: number[] = [];
    const controller = new AbortController();
    const stream = await openBrowserFrameNativeStream({
      sessionId: 'session-a',
      signal: controller.signal,
      onFrame: (bytes) => frames.push([...bytes]),
      onError: () => errors.push(1),
    });
    const emitReady = (deliveryId: number): void => {
      bridge.readyListener?.({ payload: { streamId: 's1', deliveryId } });
    };

    emitReady(1);
    emitReady(2);
    emitReady(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveBody?.(new Uint8Array([1, 2, 3]).buffer);
    await vi.waitFor(() => expect(frames).toHaveLength(2));

    expect(frames[0]).toEqual([1, 2, 3]);
    expect(frames[1]).toEqual([9]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === 'browser_frame_delivery_ack'))
      .toEqual([
        ['browser_frame_delivery_ack', { streamId: 's1', deliveryId: 1, status: 'received' }],
        ['browser_frame_delivery_ack', { streamId: 's1', deliveryId: 3, status: 'received' }],
      ]);
    expect(errors).toEqual([]);
    await stream.close();
  });

  it('pauses delivery after a resource failure and does not retry a broken stream', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('resource unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    const onError = vi.fn();
    const controller = new AbortController();
    const stream = await openBrowserFrameNativeStream({
      signal: controller.signal,
      onFrame: vi.fn(),
      onError,
    });
    bridge.readyListener?.({ payload: { streamId: 's1', deliveryId: 4 } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    bridge.readyListener?.({ payload: { streamId: 's1', deliveryId: 5 } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('browser_frame_delivery_ack', {
      streamId: 's1',
      deliveryId: 4,
      status: 'failed',
    });
    await stream.close();
  });

  it('releases a stream rejected during version negotiation', async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'browser_frame_stream_open') return { version: 99, streamId: 'rejected' };
      return undefined;
    });
    await expect(openBrowserFrameNativeStream({
      signal: new AbortController().signal, onFrame: vi.fn(), onError: vi.fn(),
    })).rejects.toThrow('unsupported native browser frame stream version');
    expect(invoke).toHaveBeenCalledWith('browser_frame_stream_close', { streamId: 'rejected' });
  });
});
