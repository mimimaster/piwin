import { describe, expect, it } from 'vitest';

import { createExecutionTracker } from './execution-tracker.js';

describe('createExecutionTracker', () => {
  it('leases a promise until it fulfills and waitIdle drains it', async () => {
    const tracker = createExecutionTracker();
    let resolve!: (value: string) => void;
    const promise = new Promise<string>((res) => {
      resolve = res;
    });

    const tracked = tracker.track(promise);
    expect(tracker.pendingCount()).toBe(1);

    resolve('ok');
    await expect(tracked).resolves.toBe('ok');
    expect(tracker.pendingCount()).toBe(0);
    await tracker.waitIdle();
  });

  it('keeps a lease across rejection so waitIdle still drains', async () => {
    const tracker = createExecutionTracker();
    const tracked = tracker.track(Promise.reject(new Error('late')));
    expect(tracker.pendingCount()).toBe(1);

    await expect(tracked).rejects.toThrow('late');
    expect(tracker.pendingCount()).toBe(0);
    await tracker.waitIdle();
  });

  it('waitIdle waits for a late settlement after the caller stopped awaiting', async () => {
    const tracker = createExecutionTracker();
    let settle!: () => void;
    const promise = new Promise<void>((res) => {
      settle = res;
    });

    void tracker.track(promise);
    expect(tracker.pendingCount()).toBeGreaterThan(0);

    const idle = tracker.waitIdle();
    settle();
    await idle;
    expect(tracker.pendingCount()).toBe(0);
  });
});
