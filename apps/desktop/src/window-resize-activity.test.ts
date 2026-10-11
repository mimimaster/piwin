// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beginPanelResize, isPanelResizeActive, subscribePanelResizeActivity } from './panel-resize-activity.js';
import { installWindowResizeActivity, WINDOW_RESIZE_SETTLE_MS } from './window-resize-activity.js';

describe('window resize activity', () => {
  const cleanups: Array<() => void> = [];

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('ignores resize notifications whose dimensions did not change', () => {
    cleanups.push(installWindowResizeActivity(window));
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(isPanelResizeActive()).toBe(false);
    expect(document.documentElement.dataset.windowResizing).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps one budget across width/height samples and settles after the last sample', () => {
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1_000);
    const height = vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    const events: boolean[] = [];
    cleanups.push(subscribePanelResizeActivity((active) => events.push(active)));
    cleanups.push(installWindowResizeActivity(window));
    width.mockReturnValue(1_020);
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.dataset.windowResizing).toBe('true');
    vi.advanceTimersByTime(WINDOW_RESIZE_SETTLE_MS - 20);
    height.mockReturnValue(820);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(WINDOW_RESIZE_SETTLE_MS - 1);
    expect(isPanelResizeActive()).toBe(true);
    expect(events).toEqual([true]);
    vi.advanceTimersByTime(1);
    expect(isPanelResizeActive()).toBe(false);
    expect(document.documentElement.dataset.windowResizing).toBeUndefined();
    expect(events).toEqual([true, false]);
  });

  it('restores normal CSS before consumers measure the settled window', () => {
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1_000);
    const settledAttributes: Array<string | undefined> = [];
    cleanups.push(subscribePanelResizeActivity((active) => {
      if (!active) settledAttributes.push(document.documentElement.dataset.windowResizing);
    }));
    cleanups.push(installWindowResizeActivity(window));
    width.mockReturnValue(1_020);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(WINDOW_RESIZE_SETTLE_MS);
    expect(settledAttributes).toEqual([undefined]);
  });

  it('does not release an overlapping panel drag when the window settles', () => {
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1_000);
    cleanups.push(installWindowResizeActivity(window));
    const releasePanel = beginPanelResize();
    cleanups.push(releasePanel);
    width.mockReturnValue(1_020);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(WINDOW_RESIZE_SETTLE_MS);
    expect(document.documentElement.dataset.windowResizing).toBeUndefined();
    expect(isPanelResizeActive()).toBe(true);
    releasePanel();
    expect(isPanelResizeActive()).toBe(false);
  });

  it('releases the budget and cancels its timer/listener on disposal', () => {
    const width = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1_000);
    const dispose = installWindowResizeActivity(window);
    cleanups.push(dispose);
    width.mockReturnValue(1_020);
    window.dispatchEvent(new Event('resize'));
    dispose();
    expect(isPanelResizeActive()).toBe(false);
    expect(document.documentElement.dataset.windowResizing).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    width.mockReturnValue(1_040);
    window.dispatchEvent(new Event('resize'));
    expect(isPanelResizeActive()).toBe(false);
  });
});
