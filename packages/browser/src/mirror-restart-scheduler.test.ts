import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMirrorRestartScheduler } from './mirror-restart-scheduler.js';

describe('createMirrorRestartScheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restarts once after a burst of resizes settles', async () => {
    vi.useFakeTimers();
    const restart = vi.fn(async () => undefined);
    const scheduler = createMirrorRestartScheduler({ restart, onError: vi.fn(), settleMs: 100 });

    for (let step = 0; step < 5; step += 1) {
      scheduler.schedule();
      await vi.advanceTimersByTimeAsync(60);
    }
    expect(restart).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('reports a failed restart and drops a cancelled one', async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const restart = vi.fn(async () => {
      throw new Error('screencast gone');
    });
    const scheduler = createMirrorRestartScheduler({ restart, onError, settleMs: 100 });

    scheduler.schedule();
    await vi.advanceTimersByTimeAsync(100);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'screencast gone' }));

    scheduler.schedule();
    scheduler.cancel();
    await vi.advanceTimersByTimeAsync(100);
    expect(restart).toHaveBeenCalledTimes(1);
  });
});
