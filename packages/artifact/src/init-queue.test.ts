import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelArtifactInit,
  getActiveArtifactInitCount,
  getQueuedArtifactInitCount,
  releaseArtifactInit,
  requestArtifactInit,
  resetArtifactInitQueueForTests,
} from './init-queue.js';

describe('artifact init queue', () => {
  beforeEach(() => {
    resetArtifactInitQueueForTests();
  });

  it('grants first request immediately', async () => {
    const grant = await requestArtifactInit('a1', { priority: 0 });
    expect(grant.granted).toBe(true);
    expect(getActiveArtifactInitCount()).toBe(1);
    releaseArtifactInit('a1');
    expect(getActiveArtifactInitCount()).toBe(0);
  });

  it('queues second request until first releases', async () => {
    await requestArtifactInit('a1', { priority: 0 });
    let secondGranted = false;
    const secondPromise = requestArtifactInit('a2', { priority: 0 }).then((grant) => {
      secondGranted = grant.granted;
      return grant;
    });
    await Promise.resolve();
    expect(secondGranted).toBe(false);
    expect(getActiveArtifactInitCount()).toBe(1);
    releaseArtifactInit('a1');
    await secondPromise;
    expect(secondGranted).toBe(true);
    expect(getActiveArtifactInitCount()).toBe(1);
    releaseArtifactInit('a2');
  });

  it('higher priority jumps ahead of FIFO queue', async () => {
    await requestArtifactInit('a1', { priority: 0 });
    const order: string[] = [];
    const lowPromise = requestArtifactInit('low', { priority: 0 }).then(() => {
      order.push('low');
    });
    const highPromise = requestArtifactInit('high', { priority: 100 }).then(() => {
      order.push('high');
    });
    await Promise.resolve();
    releaseArtifactInit('a1');
    await highPromise;
    expect(order[0]).toBe('high');
    releaseArtifactInit('high');
    await lowPromise;
    releaseArtifactInit('low');
  });

  it('double-release is safe', () => {
    void requestArtifactInit('a1');
    releaseArtifactInit('a1');
    releaseArtifactInit('a1');
    expect(getActiveArtifactInitCount()).toBe(0);
  });

  it('cancelling a queued request lets a released slot go to the next live one', async () => {
    await requestArtifactInit('a1', { priority: 0 });
    void requestArtifactInit('stale', { priority: 0 });
    const liveGranted = requestArtifactInit('live', { priority: 0 }).then((grant) => grant.granted);
    expect(getQueuedArtifactInitCount()).toBe(2);

    // "stale" unmounted while queued — drop it so it cannot burn the slot.
    cancelArtifactInit('stale');
    expect(getQueuedArtifactInitCount()).toBe(1);

    releaseArtifactInit('a1');
    expect(await liveGranted).toBe(true);
    expect(getActiveArtifactInitCount()).toBe(1);
    releaseArtifactInit('live');
  });

  it('cancel is a no-op for an active or unknown id', async () => {
    await requestArtifactInit('active');
    cancelArtifactInit('active');
    expect(getActiveArtifactInitCount()).toBe(1);
    cancelArtifactInit('never-queued');
    expect(getQueuedArtifactInitCount()).toBe(0);
    releaseArtifactInit('active');
  });
});
