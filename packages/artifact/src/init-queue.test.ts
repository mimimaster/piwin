import { beforeEach, describe, expect, it } from 'vitest';
import {
  getActiveArtifactInitCount,
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
});
