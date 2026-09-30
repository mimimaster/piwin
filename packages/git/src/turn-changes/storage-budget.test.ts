import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTurnChangeObjectStore } from './object-store.js';
import { createTurnChangeStorageBudget } from './storage-budget.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('turn-change storage budget', () => {
  it('stops keeping new bytes once full, still reuses stored ones, and recovers after a sweep', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-budget-'));
    dirs.push(root);
    const onFull = vi.fn();
    const budget = createTurnChangeStorageBudget({ limitBytes: 10, onFull });
    const store = createTurnChangeObjectStore({ rootDir: root, budget });

    const kept = await store.put(new TextEncoder().encode('12345678'));
    expect(await store.stat(kept.sha256)).toBeDefined();

    const dropped = await store.put(new TextEncoder().encode('abcdef'));
    expect(budget.isFull()).toBe(true);
    expect(onFull).toHaveBeenCalledOnce();
    expect(budget.wasDropped(dropped.sha256)).toBe(true);
    expect(await store.stat(dropped.sha256)).toBeUndefined();

    // Bytes already stored cost nothing, even when full.
    await store.put(new TextEncoder().encode('12345678'));
    expect(budget.wasDropped(kept.sha256)).toBe(false);

    budget.setMeasuredBytes(0);
    expect(budget.isFull()).toBe(false);
    const again = await store.put(new TextEncoder().encode('abcdef'));
    expect(await store.stat(again.sha256)).toBeDefined();
    const objectDirs = await readdir(join(root, 'objects'));
    expect(objectDirs.length).toBeGreaterThan(0);
  });
});
