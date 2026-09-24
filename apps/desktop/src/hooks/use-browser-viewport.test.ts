import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBrowserViewportFollowController,
  isFollowOwnedElsewhere,
  isFollowResizeRefused,
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
    expect(send).toHaveBeenCalledWith({ width: 900, height: 700 }, false);
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
    expect(send).toHaveBeenLastCalledWith({ width: 980, height: 740 }, false);
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

describe('createBrowserViewportFollowController with several windows', () => {
  const ownedElsewhere = {
    success: false,
    error: 'the viewport follows another window',
    problem: { code: 'browser-viewport-owned', retryable: false },
  };

  it('treats another window driving the viewport as normal, not a refusal', async () => {
    const onRejected = vi.fn();
    const send = vi.fn(async () => ownedElsewhere);
    const follow = createBrowserViewportFollowController({ send, onRejected, retryDelayMs: 1 });

    follow.observe({ width: 900, height: 700 });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(isFollowOwnedElsewhere(ownedElsewhere)).toBe(true);
    expect(follow.isRejected()).toBe(false);
    expect(onRejected).not.toHaveBeenCalled();
    // No retry storm against a window that simply is not in front.
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('claims the viewport with the last observed box, even at an unchanged size', async () => {
    const send = vi.fn(async () => undefined);
    const follow = createBrowserViewportFollowController({ send });

    follow.observe({ width: 900, height: 700 });
    await vi.waitFor(() => expect(follow.lastAccepted()).toBeDefined());
    follow.claim();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith({ width: 900, height: 700 }, true);
  });

  it('does nothing on claim before the panel has been measured', () => {
    const send = vi.fn(async () => undefined);
    const follow = createBrowserViewportFollowController({ send });
    follow.claim();
    expect(send).not.toHaveBeenCalled();
  });
});

describe('createBrowserViewportFollowController refusals', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats a failed Host response as a refusal, not an applied resize', () => {
    expect(isFollowResizeRefused({ success: false, error: 'frozen' })).toBe(true);
    expect(isFollowResizeRefused({ success: true })).toBe(false);
    expect(isFollowResizeRefused(undefined)).toBe(false);
  });

  it('reports the refusal, stops claiming the size, and retries until accepted', async () => {
    vi.useFakeTimers();
    const onRejected = vi.fn();
    const onAccepted = vi.fn();
    const send = vi
      .fn<(size: { width: number; height: number }) => Promise<unknown>>()
      .mockResolvedValueOnce({ success: false, error: 'follow resize is frozen' })
      .mockResolvedValue({ success: true });
    const follow = createBrowserViewportFollowController({
      send,
      onRejected,
      onAccepted,
      retryDelayMs: 1000,
    });

    follow.observe({ width: 900, height: 700 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(follow.isRejected()).toBe(true);
    // The panel must not treat the refused size as the live coordinate space.
    expect(follow.lastAccepted()).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith({ width: 900, height: 700 }, false);
    expect(follow.lastAccepted()).toEqual({ width: 900, height: 700 });
    expect(follow.isRejected()).toBe(false);
    expect(onAccepted).toHaveBeenCalledTimes(1);
    follow.dispose();
  });

  it('stops retrying after the budget and starts over on the next observation', async () => {
    vi.useFakeTimers();
    const onRejected = vi.fn();
    const send = vi.fn(async () => ({ success: false, error: 'frozen' }));
    const follow = createBrowserViewportFollowController({
      send,
      onRejected,
      retryDelayMs: 1000,
      maxRetryAttempts: 2,
    });

    follow.observe({ width: 900, height: 700 });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send).toHaveBeenCalledTimes(3);

    // Budget spent: no endless command spam while the freeze lasts.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).toHaveBeenCalledTimes(3);
    expect(onRejected).toHaveBeenCalledTimes(1);

    follow.observe({ width: 950, height: 700 });
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send).toHaveBeenLastCalledWith({ width: 950, height: 700 }, false);
    follow.dispose();
  });

  it('clears the pending retry on dispose', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => ({ success: false, error: 'frozen' }));
    const follow = createBrowserViewportFollowController({ send, retryDelayMs: 1000 });
    follow.observe({ width: 900, height: 700 });
    await vi.advanceTimersByTimeAsync(0);
    follow.dispose();
    await vi.advanceTimersByTimeAsync(10_000);
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
