import { describe, expect, it, vi } from 'vitest';
import { startScreencast } from './screencast.js';
import type { Page } from 'playwright-core';

type OnFrame = (frame: {
  data: Buffer;
  timestamp: number;
  viewportWidth: number;
  viewportHeight: number;
}) => void;

function createCapturingPage() {
  let onFrame: OnFrame | undefined;
  const start = vi.fn(async (startOptions?: { onFrame?: OnFrame }) => {
    onFrame = startOptions?.onFrame;
    return { [Symbol.dispose](): void {} };
  });
  const screencast = {
    start,
    stop: vi.fn().mockResolvedValue(undefined),
  };
  return {
    page: { screencast } as unknown as Page,
    screencast,
    emit(frame: {
      data: Buffer;
      timestamp: number;
      viewportWidth: number;
      viewportHeight: number;
    }): void {
      onFrame?.(frame);
    },
  };
}

describe('startScreencast', () => {
  it('starts JPEG screencast and emits CSS viewport frames from onFrame', async () => {
    const { page, screencast, emit } = createCapturingPage();
    const emitted: unknown[] = [];
    const handle = await startScreencast(page, {
      size: { width: 2560, height: 1600 },
      emit: (frame) => emitted.push(frame),
    });

    expect(screencast.start).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 90,
        size: { width: 2560, height: 1600 },
      }),
    );
    expect(screencast.start.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ onFrame: expect.any(Function) }),
    );

    emit({
      data: Buffer.from('abc'),
      timestamp: 1,
      viewportWidth: 1024,
      viewportHeight: 768,
    });

    expect(emitted).toEqual([
      expect.objectContaining({
        bytes: new Uint8Array(Buffer.from('abc')),
        width: 1024,
        height: 768,
      }),
    ]);

    await handle.stop();
    expect(screencast.stop).toHaveBeenCalledTimes(1);
  });

  it('uses viewportWidth/Height rather than JPEG byte size', async () => {
    const { page, emit } = createCapturingPage();
    const emitted: Array<{ width: number; height: number }> = [];
    const handle = await startScreencast(page, {
      size: { width: 2560, height: 1600 },
      emit: (frame) => emitted.push({ width: frame.width, height: frame.height }),
    });

    emit({
      data: Buffer.from([0xff, 0xd8, 0xff]),
      timestamp: 1,
      viewportWidth: 800,
      viewportHeight: 600,
    });

    expect(emitted).toEqual([{ width: 800, height: 600 }]);
    await handle.stop();
  });

  it('drops frames faster than the fps cap', async () => {
    const { page, emit } = createCapturingPage();
    let clock = 0;
    const emitted: number[] = [];
    const handle = await startScreencast(page, {
      size: { width: 2560, height: 1600 },
      maxFps: 10,
      now: () => clock,
      emit: (frame) => emitted.push(frame.ts),
    });

    const sample = {
      data: Buffer.from('x'),
      timestamp: 0,
      viewportWidth: 1280,
      viewportHeight: 800,
    };
    emit(sample);
    clock = 50;
    emit(sample);
    clock = 99;
    emit(sample);
    clock = 100;
    emit(sample);

    expect(emitted).toEqual([0, 100]);
    await handle.stop();
  });

  it('does not throw from onFrame when emit throws', async () => {
    const { page, emit } = createCapturingPage();
    const handle = await startScreencast(page, {
      size: { width: 800, height: 600 },
      emit: () => {
        throw new Error('subscriber failed');
      },
    });
    expect(() =>
      emit({
        data: Buffer.from('x'),
        timestamp: 1,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    ).not.toThrow();
    await handle.stop();
  });

  it('calls page.screencast.stop and ignores later frames', async () => {
    const { page, screencast, emit } = createCapturingPage();
    const emitted: unknown[] = [];
    const handle = await startScreencast(page, {
      size: { width: 2560, height: 1600 },
      emit: (frame) => emitted.push(frame),
    });
    await handle.stop();
    emit({
      data: Buffer.from('late'),
      timestamp: 2,
      viewportWidth: 1280,
      viewportHeight: 800,
    });
    expect(emitted).toHaveLength(0);
    expect(screencast.stop).toHaveBeenCalledTimes(1);
    await handle.stop();
    expect(screencast.stop).toHaveBeenCalledTimes(1);
  });

  it('rebuilds once when start throws leftover already-started, then succeeds', async () => {
    let attempts = 0;
    let onFrame: OnFrame | undefined;
    const start = vi.fn(async (startOptions?: { onFrame?: OnFrame }) => {
      attempts += 1;
      onFrame = startOptions?.onFrame;
      if (attempts === 1) throw new Error('Screencast is already started');
      return { [Symbol.dispose](): void {} };
    });
    const screencast = {
      start,
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const page = { screencast } as unknown as Page;
    const emitted: unknown[] = [];
    const handle = await startScreencast(page, {
      size: { width: 2560, height: 1600 },
      emit: (frame) => emitted.push(frame),
    });
    expect(start).toHaveBeenCalledTimes(2);
    expect(screencast.stop).toHaveBeenCalled();
    onFrame?.({
      data: Buffer.from('ok'),
      timestamp: 1,
      viewportWidth: 1280,
      viewportHeight: 800,
    });
    expect(emitted).toHaveLength(1);
    await handle.stop();
  });

  it('throws the original error after one failed rebuild', async () => {
    const start = vi.fn().mockRejectedValue(new Error('screencast denied'));
    const stop = vi.fn().mockResolvedValue(undefined);
    const page = { screencast: { start, stop } } as unknown as Page;
    await expect(startScreencast(page, { size: { width: 2560, height: 1600 }, emit: vi.fn() })).rejects.toThrow(
      'screencast denied',
    );
    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalled();
  });

  it('does not open a CDP session', async () => {
    const { page } = createCapturingPage();
    const context = vi.fn();
    (page as unknown as { context: typeof context }).context = context;
    const handle = await startScreencast(page, { size: { width: 2560, height: 1600 }, emit: vi.fn() });
    expect(context).not.toHaveBeenCalled();
    await handle.stop();
  });
});
