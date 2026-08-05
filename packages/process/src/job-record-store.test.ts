import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JobRecord } from '@piwin/contracts';

import {
  createFileRecordStore,
  createMemoryRecordStore,
} from './job-record-store.js';

function makeRecord(overrides?: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job-1',
    kind: 'command',
    lifetime: 'host',
    command: 'echo',
    argv: ['hello'],
    cwd: '/tmp',
    status: 'running',
    startedAt: '2025-01-01T00:00:00.000Z',
    latestLogCursor: 0,
    ...overrides,
  };
}

describe('createMemoryRecordStore', () => {
  it('saves and loads records', () => {
    const store = createMemoryRecordStore();
    store.save(makeRecord({ jobId: 'job-a', status: 'running' }));
    store.save(makeRecord({ jobId: 'job-b', status: 'exited' }));
    const all = store.loadAll();
    expect(all).toHaveLength(2);
    expect(all.map((r) => r.jobId).sort()).toEqual(['job-a', 'job-b']);
  });

  it('clones argv on save so external mutations do not leak', () => {
    const store = createMemoryRecordStore();
    const argv = ['hello'];
    store.save(makeRecord({ jobId: 'job-1', argv }));
    argv.push('world');
    const [loaded] = store.loadAll();
    expect(loaded!.argv).toEqual(['hello']);
  });

  it('removes records by jobId', () => {
    const store = createMemoryRecordStore();
    store.save(makeRecord({ jobId: 'job-a' }));
    store.save(makeRecord({ jobId: 'job-b' }));
    store.remove('job-a');
    const all = store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.jobId).toBe('job-b');
  });

  it('dispose is a no-op', async () => {
    const store = createMemoryRecordStore();
    store.save(makeRecord());
    await store.dispose();
    // Still works after dispose (in-memory has no resources to release).
    expect(store.loadAll()).toHaveLength(1);
  });
});

describe('createFileRecordStore', () => {
  it('returns empty when the file does not exist', () => {
    const store = createFileRecordStore(join('/nonexistent', 'records.json'));
    expect(store.loadAll()).toHaveLength(0);
  });

  it('persists records to disk after debounce flush', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-record-store-'));
    const filePath = join(dir, 'records.json');
    const store = createFileRecordStore(filePath, { flushDebounceMs: 50 });
    store.save(makeRecord({ jobId: 'job-a', status: 'running' }));
    store.save(makeRecord({ jobId: 'job-b', status: 'exited' }));

    // Wait for debounce flush.
    await new Promise((resolve) => setTimeout(resolve, 120));

    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, JobRecord>;
    expect(Object.keys(parsed).sort()).toEqual(['job-a', 'job-b']);
    expect(parsed['job-a']!.status).toBe('running');
    expect(parsed['job-b']!.status).toBe('exited');
  });

  it('loads previously persisted records from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-record-store-'));
    const filePath = join(dir, 'records.json');
    // Pre-write a records file.
    const preExisting: Record<string, JobRecord> = {
      'old-job': makeRecord({ jobId: 'old-job', status: 'exited' }),
    };
    await writeFile(filePath, JSON.stringify(preExisting, null, 2), 'utf8');

    const store = createFileRecordStore(filePath);
    const all = store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.jobId).toBe('old-job');
    expect(all[0]!.status).toBe('exited');
  });

  it('removes records and persists removal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-record-store-'));
    const filePath = join(dir, 'records.json');
    const store = createFileRecordStore(filePath, { flushDebounceMs: 50 });
    store.save(makeRecord({ jobId: 'job-a' }));
    store.save(makeRecord({ jobId: 'job-b' }));
    store.remove('job-a');

    await new Promise((resolve) => setTimeout(resolve, 120));

    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, JobRecord>;
    expect(Object.keys(parsed)).toEqual(['job-b']);
  });

  it('handles corrupt JSON gracefully', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-record-store-'));
    const filePath = join(dir, 'records.json');
    await writeFile(filePath, 'not valid json{{{', 'utf8');

    const store = createFileRecordStore(filePath);
    expect(store.loadAll()).toHaveLength(0);
  });

  it('dispose flushes pending writes before releasing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-record-store-'));
    const filePath = join(dir, 'records.json');
    const store = createFileRecordStore(filePath, { flushDebounceMs: 50 });
    store.save(makeRecord({ jobId: 'job-a' }));
    // The final terminal record must be durable before dispose resolves.
    await store.dispose();

    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, JobRecord>;
    expect(parsed['job-a']).toBeDefined();

    // Save after dispose should be a no-op.
    store.save(makeRecord({ jobId: 'job-b' }));

    // Wait to see if anything was written.
    await new Promise((resolve) => setTimeout(resolve, 120));

    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, JobRecord>;
      expect(parsed['job-b']).toBeUndefined();
    } catch {
      // File must exist now (the dispose flush wrote it).
      throw new Error('records.json was not written by dispose flush');
    }
  });

  it('dispose awaits an in-flight debounce flush', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-record-store-'));
    const filePath = join(dir, 'records.json');
    const store = createFileRecordStore(filePath, { flushDebounceMs: 10 });
    store.save(makeRecord({ jobId: 'job-a', status: 'cancelled' }));
    store.save(makeRecord({ jobId: 'job-b', status: 'failed' }));

    // Dispose immediately: the debounced flush may not have fired yet, so
    // dispose must force a final flush so both records are durable.
    await store.dispose();

    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, JobRecord>;
    expect(Object.keys(parsed).sort()).toEqual(['job-a', 'job-b']);
  });
});
