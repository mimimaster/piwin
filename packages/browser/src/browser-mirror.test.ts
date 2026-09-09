import { describe, expect, it, vi } from 'vitest';
import { createBrowserMirror } from './browser-mirror.js';
import type { BrowserSessionEvent } from './browser-session.js';
import type { Page } from 'playwright-core';

type OnFrame = (frame: {
  data: Buffer;
  timestamp: number;
  viewportWidth: number;
  viewportHeight: number;
}) => void;

function createPage(options?: { start?: ReturnType<typeof vi.fn> }) {
  const start =
    options?.start ??
    vi.fn(async (_startOptions?: { onFrame?: OnFrame }) => {
      return { [Symbol.dispose](): void {} };
    });
  const page = {
    screencast: {
      start,
      stop: vi.fn().mockResolvedValue(undefined),
    },
    screenshot: vi.fn().mockResolvedValue(Buffer.from('jpegbytes')),
    viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 800 }),
  };
  return {
    page: page as unknown as Page,
    raw: page,
    emit(frame: {
      data: Buffer;
      timestamp: number;
      viewportWidth: number;
      viewportHeight: number;
    }): void {
      const listener = start.mock.calls[0]?.[0]?.onFrame as OnFrame | undefined;
      listener?.(frame);
    },
  };
}

function createMirror(page: Page, options?: { lease?: boolean }) {
  const events: BrowserSessionEvent[] = [];
  const subscribers = new Set<(event: BrowserSessionEvent) => void>();
  subscribers.add((event) => events.push(event));
  let lease = options?.lease ?? true;
  const mirror = createBrowserMirror({
    maxDimension: 1280,
    maxFps: 4,
    getPage: async () => page,
    hasActiveMirrorLease: () => lease,
    resolveDeviceScaleFactor: async () => 2,
    subscribers,
  });
  return {
    mirror,
    events,
    setLease(next: boolean) {
      lease = next;
    },
  };
}

describe('createBrowserMirror', () => {
  it('emits CSS viewport frames from page.screencast onFrame and does not start screenshots', async () => {
    const { page, raw, emit } = createPage();
    const { mirror, events } = createMirror(page);
    await mirror.startMirrorFrames(page);

    expect(mirror.hasScreencast()).toBe(true);
    expect(raw.screencast.start).toHaveBeenCalledTimes(1);
    expect(raw.screencast.start).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 80,
        size: { width: 2560, height: 1600 },
        onFrame: expect.any(Function),
      }),
    );

    emit({
      data: Buffer.from('abc'),
      timestamp: 1,
      viewportWidth: 1024,
      viewportHeight: 768,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'browser/frame',
        dataUrl: `data:image/jpeg;base64,${Buffer.from('abc').toString('base64')}`,
        width: 1024,
        height: 768,
      }),
    ]);

    await mirror.frameLoop.requestFrame();
    expect(raw.screenshot).not.toHaveBeenCalled();

    await mirror.startMirrorFrames(page);
    expect(raw.screencast.start).toHaveBeenCalledTimes(1);

    await mirror.stopScreencast();
    mirror.frameLoop.stop();
    expect(raw.screencast.stop).toHaveBeenCalled();
    expect(mirror.hasScreencast()).toBe(false);
  });

  it('falls back to screenshot frames when start throws and does not relaunch Chromium', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const start = vi.fn().mockRejectedValue(new Error('screencast unavailable'));
    const { page, raw } = createPage({ start });
    const { mirror, events } = createMirror(page);

    await mirror.startMirrorFrames(page);

    expect(mirror.hasScreencast()).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[browser] screencast failed; falling back to screenshot frames',
      'screencast unavailable',
    );

    await mirror.frameLoop.requestFrame();
    expect(raw.screenshot).toHaveBeenCalledWith({ type: 'jpeg', quality: 80 });
    expect(events.some((event) => event.type === 'browser/frame')).toBe(true);

    mirror.frameLoop.stop();
    warn.mockRestore();
  });

  it('starts screenshot fallback after a live screencast stops while the lease is held', async () => {
    const { page, raw } = createPage();
    const { mirror } = createMirror(page);
    await mirror.startMirrorFrames(page);
    expect(mirror.hasScreencast()).toBe(true);

    await mirror.stopScreencast();
    expect(mirror.hasScreencast()).toBe(false);
    expect(raw.screencast.stop).toHaveBeenCalled();

    await mirror.frameLoop.requestFrame();
    expect(raw.screenshot).toHaveBeenCalled();
    mirror.frameLoop.stop();
  });

  it('restarts screencast when the CSS viewport changes', async () => {
    const { page, raw } = createPage();
    const { mirror } = createMirror(page);
    await mirror.startMirrorFrames(page);
    expect(raw.screencast.start).toHaveBeenCalledTimes(1);

    raw.viewportSize.mockReturnValue({ width: 1024, height: 768 });
    await mirror.startMirrorFrames(page);

    expect(raw.screencast.stop).toHaveBeenCalled();
    expect(raw.screencast.start).toHaveBeenCalledTimes(2);
    expect(raw.screencast.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        quality: 80,
        size: { width: 2048, height: 1536 },
      }),
    );
    await mirror.stopScreencast();
    mirror.frameLoop.stop();
  });

  it('does not start screenshot fallback when stop releases a producer without a lease', async () => {
    const { page, raw } = createPage();
    const { mirror, setLease } = createMirror(page);
    await mirror.startMirrorFrames(page);
    setLease(false);
    await mirror.stopScreencast();
    await mirror.frameLoop.requestFrame();
    expect(raw.screenshot).not.toHaveBeenCalled();
    mirror.frameLoop.stop();
  });
});
