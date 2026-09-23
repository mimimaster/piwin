import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkerJsonlWriter } from './host-serve-worker-jsonl-writer.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('createWorkerJsonlWriter', () => {
  it('writes lines in order off the main thread and settles the backlog', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-worker-writer-'));
    roots.push(root);
    const path = join(root, 'out.jsonl');
    const handle = await open(path, 'w');
    try {
      const writer = createWorkerJsonlWriter(handle.fd);
      const writes = [1, 2, 3].map((index) => writer.write({ type: 'push', index }));
      expect(writer.pendingBytes()).toBeGreaterThan(0);
      await Promise.all(writes);
      expect(writer.pendingBytes()).toBe(0);
    } finally {
      await handle.close();
    }
    const lines = (await readFile(path, 'utf8')).trim().split('\n');
    expect(lines.map((line) => (JSON.parse(line) as { index: number }).index)).toEqual([1, 2, 3]);
  });

  it('rejects a write the worker cannot perform', async () => {
    const writer = createWorkerJsonlWriter(987_654);
    await expect(writer.write({ type: 'push' })).rejects.toThrow(/stdout write failed/);
    expect(writer.pendingBytes()).toBe(0);
  });
});
