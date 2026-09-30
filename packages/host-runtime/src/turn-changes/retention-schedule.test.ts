import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openTurnChangeStore, type TurnChangeStore } from '@piwin/git';
import { scheduleTurnChangeRetention } from './retention-schedule.js';

const directories: string[] = [];
const stores: TurnChangeStore[] = [];

async function openStore(): Promise<{ store: TurnChangeStore; rootDir: string }> {
  const rootDir = await mkdtemp(join(tmpdir(), 'piwin-tc-retention-schedule-'));
  directories.push(rootDir);
  const store = openTurnChangeStore({ rootDir });
  stores.push(store);
  return { store, rootDir };
}

afterEach(async () => {
  vi.useRealTimers();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('scheduleTurnChangeRetention', () => {
  it('runNow sweeps and reports the result; concurrent calls share one sweep', async () => {
    const { store, rootDir } = await openStore();
    const onResult = vi.fn();
    const schedule = scheduleTurnChangeRetention({
      store,
      rootDir,
      initialDelayMs: 60_000,
      onResult,
      onError: () => {
        throw new Error('unexpected sweep error');
      },
    });
    const [first, second] = await Promise.all([schedule.runNow(), schedule.runNow()]);
    schedule.stop();

    expect(first).toEqual({
      expiredChangeSets: 0,
      deletedObjects: 0,
      freedBytes: 0,
      deletedTempFiles: 0,
      storedBytes: 0,
    });
    expect(second).toBeNull();
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('reports a failed sweep through onError instead of rejecting', async () => {
    const { store, rootDir } = await openStore();
    store.close();
    stores.splice(0);
    const onError = vi.fn();
    const schedule = scheduleTurnChangeRetention({ store, rootDir, initialDelayMs: 60_000, onError });

    await expect(schedule.runNow()).resolves.toBeNull();
    schedule.stop();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('fires after the initial delay and not after stop', async () => {
    vi.useFakeTimers();
    const { store, rootDir } = await openStore();
    const onResult = vi.fn();
    const schedule = scheduleTurnChangeRetention({
      store,
      rootDir,
      initialDelayMs: 1_000,
      intervalMs: 5_000,
      onResult,
      onError: () => undefined,
    });
    schedule.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onResult).not.toHaveBeenCalled();
    await expect(schedule.runNow()).resolves.toBeNull();
  });
});
