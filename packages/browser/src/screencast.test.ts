import { describe, expect, it, vi } from 'vitest';
import { startScreencast } from './screencast.js';
import type { Page } from 'playwright-core';

function createCdp() {
  const listeners = new Map<string, (payload: unknown) => void>();
  return {
    on: vi.fn((event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, listener);
    }),
    send: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    emit(event: string, payload: unknown) {
      listeners.get(event)?.(payload);
    },
  };
}

describe('startScreencast', () => {
  it('starts JPEG screencast, emits CSS viewport frames, and acks every frame', async () => {
    const cdp = createCdp();
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdp) }),
    } as unknown as Page;
    const emit = vi.fn();
    const handle = await startScreencast(page, { maxDimension: 1280, emit });

    expect(cdp.send).toHaveBeenCalledWith(
      'Page.startScreencast',
      expect.objectContaining({ format: 'jpeg', maxWidth: 1280, maxHeight: 1280 }),
    );

    cdp.emit('Page.screencastFrame', {
      data: 'abc',
      sessionId: 7,
      metadata: { deviceWidth: 1024, deviceHeight: 768 },
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        dataUrl: 'data:image/jpeg;base64,abc',
        width: 1024,
        height: 768,
      }),
    );
    expect(cdp.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 7 });

    await handle.stop();
    expect(cdp.send).toHaveBeenCalledWith('Page.stopScreencast');
    expect(cdp.detach).toHaveBeenCalled();
  });

  it('acks even when emit throws', async () => {
    const cdp = createCdp();
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdp) }),
    } as unknown as Page;
    const handle = await startScreencast(page, {
      maxDimension: 800,
      emit: () => {
        throw new Error('subscriber failed');
      },
    });
    cdp.emit('Page.screencastFrame', {
      data: 'x',
      sessionId: 1,
      metadata: { deviceWidth: 800, deviceHeight: 600 },
    });
    expect(cdp.send).toHaveBeenCalledWith('Page.screencastFrameAck', { sessionId: 1 });
    await handle.stop();
  });

  it('detaches when startScreencast fails', async () => {
    const cdp = createCdp();
    cdp.send.mockImplementation((method: string) => {
      if (method === 'Page.startScreencast') return Promise.reject(new Error('cdp denied'));
      return Promise.resolve(undefined);
    });
    const page = {
      context: () => ({ newCDPSession: vi.fn().mockResolvedValue(cdp) }),
    } as unknown as Page;
    await expect(startScreencast(page, { maxDimension: 1280, emit: vi.fn() })).rejects.toThrow(
      'cdp denied',
    );
    expect(cdp.detach).toHaveBeenCalled();
  });
});
