import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserViewportFollowController,
  resolveFollowViewportBox,
  resolveViewportPresetId,
  shouldSendFollowResize,
} from './use-browser-viewport';

describe('resolveFollowViewportBox', () => {
  it('rounds the measured box and rejects degenerate sizes', () => {
    expect(resolveFollowViewportBox({ getBoundingClientRect: () => ({ width: 812.6, height: 640.4 }) })).toEqual({
      width: 813,
      height: 640,
    });
    expect(resolveFollowViewportBox({ getBoundingClientRect: () => ({ width: 0, height: 0 }) })).toBeUndefined();
    expect(resolveFollowViewportBox(null)).toBeUndefined();
  });
});

describe('shouldSendFollowResize', () => {
  it('accepts the first observation and any real pixel change', () => {
    expect(shouldSendFollowResize(undefined, { width: 900, height: 700 })).toBe(true);
    expect(shouldSendFollowResize({ width: 900, height: 700 }, { width: 900, height: 700 })).toBe(false);
    expect(shouldSendFollowResize({ width: 900, height: 700 }, { width: 901, height: 700 })).toBe(true);
    expect(shouldSendFollowResize({ width: 900, height: 700 }, { width: 900, height: 699 })).toBe(true);
  });
});

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createBrowserViewportFollowController', () => {
  it('sends the first change immediately', () => {
    const send = vi.fn(async () => undefined);
    const follow = createBrowserViewportFollowController({ send });
    follow.observe({ width: 900, height: 700 });
    expect(send).toHaveBeenCalledWith({ width: 900, height: 700 });
  });

  it('collapses churn during an in-flight resize into the latest size', async () => {
    const first = deferred();
    const send = vi
      .fn<(size: { width: number; height: number }) => Promise<unknown>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const follow = createBrowserViewportFollowController({ send });

    follow.observe({ width: 900, height: 700 });
    follow.observe({ width: 940, height: 720 });
    follow.observe({ width: 980, height: 740 });
    expect(send).toHaveBeenCalledTimes(1);

    first.resolve();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith({ width: 980, height: 740 });
    await vi.waitFor(() => expect(follow.lastAccepted()).toEqual({ width: 980, height: 740 }));
  });

  it('keeps the previous accepted size when the Host rejects the resize', async () => {
    const send = vi
      .fn<(size: { width: number; height: number }) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue(undefined);
    const follow = createBrowserViewportFollowController({ send });

    follow.observe({ width: 900, height: 700 });
    await Promise.resolve();
    // No optimistic coordinate space after a failure.
    expect(follow.lastAccepted()).toBeUndefined();

    follow.observe({ width: 940, height: 700 });
    await vi.waitFor(() => expect(follow.lastAccepted()).toEqual({ width: 940, height: 700 }));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('drops observations after dispose', () => {
    const send = vi.fn(async () => undefined);
    const follow = createBrowserViewportFollowController({ send });
    follow.dispose();
    follow.observe({ width: 1200, height: 900 });
    expect(send).not.toHaveBeenCalled();
  });

  it('does not resend an unchanged size', async () => {
    const send = vi.fn(async () => undefined);
    const follow = createBrowserViewportFollowController({ send });

    follow.observe({ width: 900, height: 700 });
    await vi.waitFor(() => expect(follow.lastAccepted()).toBeDefined());
    follow.observe({ width: 900, height: 700 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('resolveViewportPresetId', () => {
  it('maps stored preferences back onto menu entries', () => {
    expect(resolveViewportPresetId({ mode: 'follow', width: 1280, height: 800 })).toBe('responsive');
    expect(resolveViewportPresetId({ mode: 'fixed', width: 1280, height: 800 })).toBe('desktop');
    expect(resolveViewportPresetId({ mode: 'mobile', width: 375, height: 812 })).toBe('mobile');
  });

  it('recognises the tablet preset by its dimensions', () => {
    expect(resolveViewportPresetId({ mode: 'custom', width: 768, height: 1024 })).toBe('tablet');
    expect(resolveViewportPresetId({ mode: 'custom', width: 900, height: 700 })).toBe('custom');
    expect(resolveViewportPresetId({ mode: 'custom', width: 768, height: 700 })).toBe('custom');
  });
});
