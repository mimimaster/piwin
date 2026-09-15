import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS,
  createBrowserViewportFollowController,
  resolveFollowViewportBox,
  resolveViewportPresetId,
  shouldSendFollowResize,
} from './use-browser-viewport';

afterEach(() => {
  vi.useRealTimers();
});

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
  it('accepts the first observation and ignores sub-8px churn', () => {
    expect(shouldSendFollowResize(undefined, { width: 900, height: 700 })).toBe(true);
    expect(shouldSendFollowResize({ width: 900, height: 700 }, { width: 907, height: 704 })).toBe(false);
    expect(shouldSendFollowResize({ width: 900, height: 700 }, { width: 908, height: 700 })).toBe(true);
    expect(shouldSendFollowResize({ width: 900, height: 700 }, { width: 900, height: 710 })).toBe(true);
  });
});

describe('createBrowserViewportFollowController', () => {
  it('debounces continuous churn into one request', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const follow = createBrowserViewportFollowController({ send });

    follow.observe({ width: 900, height: 700 });
    follow.observe({ width: 940, height: 720 });
    follow.observe({ width: 980, height: 740 });
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ width: 980, height: 740 });
    expect(follow.lastAccepted()).toEqual({ width: 980, height: 740 });
  });

  it('holds the intent while the agent holds the lock and commits after release', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const follow = createBrowserViewportFollowController({ send });

    follow.setController('agent');
    follow.observe({ width: 1024, height: 768 });
    await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 1);
    expect(send).not.toHaveBeenCalled();

    follow.setController('user');
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ width: 1024, height: 768 });
  });

  it('keeps the previous accepted size when the Host rejects the resize', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<(size: { width: number; height: number }) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue(undefined);
    const follow = createBrowserViewportFollowController({ send });

    follow.observe({ width: 900, height: 700 });
    await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(1);
    // No optimistic coordinate space after a failure.
    expect(follow.lastAccepted()).toBeUndefined();

    follow.observe({ width: 940, height: 700 });
    await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(follow.lastAccepted()).toEqual({ width: 940, height: 700 });
  });

  it('drops observations and pending sends after dispose', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const follow = createBrowserViewportFollowController({ send });

    follow.observe({ width: 900, height: 700 });
    follow.dispose();
    await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 1);
    follow.observe({ width: 1200, height: 900 });
    await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 1);
    expect(send).not.toHaveBeenCalled();
  });

  it('does not resend an unchanged size', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => undefined);
    const follow = createBrowserViewportFollowController({ send });

    follow.observe({ width: 900, height: 700 });
    await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 1);
    follow.observe({ width: 903, height: 702 });
    await vi.advanceTimersByTimeAsync(BROWSER_FOLLOW_RESIZE_DEBOUNCE_MS + 1);
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
