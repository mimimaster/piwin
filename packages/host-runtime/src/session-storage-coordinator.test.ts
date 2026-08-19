import { describe, expect, it, vi } from 'vitest';
import { createSessionStorageCoordinator } from './session-storage-coordinator.js';

describe('SessionStorageCoordinator', () => {
  it('serializes locks for the same session', async () => {
    const coordinator = createSessionStorageCoordinator();
    const order: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = coordinator.withLock('ses_1', async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-end');
    });
    const second = coordinator.withLock('ses_1', async () => {
      order.push('second');
    });
    await vi.waitFor(() => {
      expect(order).toEqual(['first-start']);
    });
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });
});
