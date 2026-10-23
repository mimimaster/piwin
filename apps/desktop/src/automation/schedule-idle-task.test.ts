import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleIdleTask } from './schedule-idle-task';

describe('scheduleIdleTask', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses requestIdleCallback when available', () => {
    const cancel = vi.fn();
    const request = vi.fn((callback: () => void, _options?: { timeout: number }) => {
      callback();
      return 7;
    });
    vi.stubGlobal('requestIdleCallback', request);
    vi.stubGlobal('cancelIdleCallback', cancel);
    const task = vi.fn();
    const dispose = scheduleIdleTask(task, 1_000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[1]).toEqual({ timeout: 1_000 });
    expect(task).toHaveBeenCalledTimes(1);
    dispose();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('falls back to setTimeout when requestIdleCallback is missing', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    const task = vi.fn();
    const dispose = scheduleIdleTask(task);
    expect(task).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(task).toHaveBeenCalledTimes(1);
    dispose();
  });
});
