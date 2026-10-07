import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppleHealthRecord, HealthSummarySyncBatchV1 } from '@piwin/contracts';
import { isHealthDigestDue } from './digest-schedule.js';
import { HealthSummaryStore } from './summary-store.js';
import { loadOrCreateHealthStoreKey } from './summary-store-crypto.js';

const directories: string[] = [];

async function createStore(): Promise<{ store: HealthSummaryStore; filePath: string; reopen: () => HealthSummaryStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-health-'));
  directories.push(directory);
  const filePath = join(directory, 'summaries.v1.enc');
  const loadKey = () => loadOrCreateHealthStoreKey(join(directory, 'summaries.key'));
  const open = () => new HealthSummaryStore({ filePath, loadKey });
  return { store: open(), filePath, reopen: open };
}

function steps(localDate: string, value: number): AppleHealthRecord {
  return { metric: 'steps', localDate, unit: 'count', value, freshAsOf: '2026-10-07T04:00:00.000Z' };
}

function batch(overrides: Partial<HealthSummarySyncBatchV1>): HealthSummarySyncBatchV1 {
  return {
    schemaVersion: 1,
    batchId: 'batch-1',
    generatedAt: '2026-10-07T04:00:00.000Z',
    timeZone: 'Asia/Shanghai',
    startDate: '2026-10-05',
    endDateExclusive: '2026-10-08',
    metrics: ['steps'],
    records: [steps('2026-10-05', 8000), steps('2026-10-06', 9000), steps('2026-10-07', 1200)],
    ...overrides,
  };
}

const WINDOW = { metrics: ['steps'] as const, startDate: '2026-10-01', endDateExclusive: '2026-10-08' };

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('HealthSummaryStore', () => {
  it('keeps summaries encrypted on disk and reads them back after a restart', async () => {
    const { store, filePath, reopen } = await createStore();
    await store.applyBatch('device-a', batch({}));
    const onDisk = await readFile(filePath, 'utf8');
    expect(onDisk).not.toContain('steps');
    expect(onDisk).not.toContain('8000');
    const read = await reopen().read(WINDOW);
    expect(read.records.map((record) => record.value)).toEqual([8000, 9000, 1200]);
    expect(read.timeZone).toBe('Asia/Shanghai');
  });

  it('replaces the whole window: a day the phone no longer reports is removed', async () => {
    const { store } = await createStore();
    await store.applyBatch('device-a', batch({}));
    await store.applyBatch(
      'device-a',
      batch({
        batchId: 'batch-2',
        generatedAt: '2026-10-07T09:00:00.000Z',
        records: [steps('2026-10-05', 8000), steps('2026-10-07', 5400)],
      }),
    );
    const read = await store.read(WINDOW);
    expect(read.records.map((record) => [record.localDate, record.value])).toEqual([
      ['2026-10-05', 8000],
      ['2026-10-07', 5400],
    ]);
  });

  it('ignores a delayed older batch for days a newer one already wrote', async () => {
    const { store } = await createStore();
    await store.applyBatch('device-a', batch({ generatedAt: '2026-10-07T09:00:00.000Z' }));
    const result = await store.applyBatch(
      'device-a',
      batch({ batchId: 'stale', generatedAt: '2026-10-07T01:00:00.000Z', records: [steps('2026-10-07', 1)] }),
    );
    expect(result.applied).toBe(false);
    expect((await store.read(WINDOW)).records).toHaveLength(3);
  });

  it('leaves metrics a batch does not cover untouched', async () => {
    const { store } = await createStore();
    await store.applyBatch('device-a', batch({}));
    await store.applyBatch(
      'device-a',
      batch({
        batchId: 'sleep',
        metrics: ['sleep-duration'],
        records: [
          { metric: 'sleep-duration', localDate: '2026-10-07', unit: 'minute', value: 430, freshAsOf: '2026-10-07T04:00:00.000Z' },
        ],
      }),
    );
    const read = await store.read({ ...WINDOW, metrics: ['steps', 'sleep-duration'] });
    expect(read.records).toHaveLength(4);
  });

  it('deletes one device or everything, durably', async () => {
    const { store, reopen } = await createStore();
    await store.applyBatch('device-a', batch({}));
    await store.applyBatch('device-b', batch({ batchId: 'b' }));
    await store.deleteDevice('device-a');
    expect((await reopen().status()).map((device) => device.deviceId)).toEqual(['device-b']);
    await store.deleteAll();
    expect(await reopen().status()).toEqual([]);
  });

  it('prunes days beyond the retention window', async () => {
    const { store } = await createStore();
    await store.applyBatch('device-a', batch({}));
    await store.prune(1, '2026-10-07');
    expect((await store.read(WINDOW)).records.map((record) => record.localDate)).toEqual([
      '2026-10-06',
      '2026-10-07',
    ]);
  });
});

describe('isHealthDigestDue', () => {
  const daily = { enabled: true, cadence: 'daily' as const, time: '08:00', weekday: 1 };

  it('runs once per day after the scheduled time', () => {
    expect(isHealthDigestDue(daily, new Date(2026, 9, 7, 7, 59), undefined)).toBe(false);
    expect(isHealthDigestDue(daily, new Date(2026, 9, 7, 8, 0), undefined)).toBe(true);
    const ranToday = new Date(2026, 9, 7, 8, 1).toISOString();
    expect(isHealthDigestDue(daily, new Date(2026, 9, 7, 12, 0), ranToday)).toBe(false);
    expect(isHealthDigestDue(daily, new Date(2026, 9, 8, 8, 5), ranToday)).toBe(true);
  });

  it('catches up later the same day when the Host was asleep', () => {
    const ranYesterday = new Date(2026, 9, 6, 8, 0).toISOString();
    expect(isHealthDigestDue(daily, new Date(2026, 9, 7, 15, 30), ranYesterday)).toBe(true);
  });

  it('runs a weekly digest only on its weekday and never when disabled', () => {
    const weekly = { ...daily, cadence: 'weekly' as const, weekday: 3 };
    // 2026-10-07 is a Wednesday.
    expect(isHealthDigestDue(weekly, new Date(2026, 9, 7, 9, 0), undefined)).toBe(true);
    expect(isHealthDigestDue(weekly, new Date(2026, 9, 8, 9, 0), undefined)).toBe(false);
    expect(isHealthDigestDue({ ...daily, enabled: false }, new Date(2026, 9, 7, 9, 0), undefined)).toBe(false);
  });
});
