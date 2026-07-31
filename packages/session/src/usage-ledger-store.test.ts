import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '@piwin/contracts';
import {
  appendUsageRecord,
  computeUsageRollup,
  loadUsageRecords,
  readUsageRollup,
} from './usage-ledger-store.js';

function record(partial: Partial<UsageRecord>): UsageRecord {
  return {
    sessionId: 's1',
    projectPath: '/tmp/proj',
    totalTokens: 100,
    promptTokens: 60,
    completionTokens: 40,
    source: 'assistant-usage',
    recordedAt: '2026-08-01T10:00:00.000Z',
    ...partial,
  };
}

describe('usage-ledger-store', () => {
  it('appends JSONL and reloads records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-usage-'));
    const filePath = join(dir, 'ledger.jsonl');
    await appendUsageRecord(filePath, record({ sessionId: 's1' }));
    await appendUsageRecord(filePath, record({ sessionId: 's2', totalTokens: 50 }));
    const records = await loadUsageRecords(filePath);
    expect(records).toHaveLength(2);
    expect(records[0]?.sessionId).toBe('s1');
    expect(records[1]?.totalTokens).toBe(50);
  });

  it('skips corrupt lines and missing ledger files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-usage-'));
    const filePath = join(dir, 'ledger.jsonl');
    // Missing file → empty list.
    expect(await loadUsageRecords(filePath)).toEqual([]);
    // Corrupt line does not block reads.
    await appendUsageRecord(filePath, record({ sessionId: 's1' }));
    await appendUsageRecord(filePath, { garbage: true } as unknown as UsageRecord);
    const records = await loadUsageRecords(filePath);
    expect(records).toHaveLength(1);
    expect(records[0]?.sessionId).toBe('s1');
  });

  it('computes totals, byModel, byDay and per-session rollup', async () => {
    const records = [
      record({ sessionId: 's1', modelId: 'm1', totalTokens: 100, promptTokens: 60, completionTokens: 40, recordedAt: '2026-08-01T10:00:00.000Z' }),
      record({ sessionId: 's1', modelId: 'm1', totalTokens: 200, promptTokens: 120, completionTokens: 80, recordedAt: '2026-08-01T11:00:00.000Z' }),
      record({ sessionId: 's2', modelId: 'm2', totalTokens: 50, promptTokens: 10, completionTokens: 40, recordedAt: '2026-08-02T09:00:00.000Z' }),
    ];
    const rollup = computeUsageRollup(records);
    expect(rollup.totalTokens).toBe(350);
    expect(rollup.promptTokens).toBe(190);
    expect(rollup.completionTokens).toBe(160);
    expect(rollup.entryCount).toBe(3);
    expect(rollup.sessionCount).toBe(2);
    expect(rollup.firstAt).toBe('2026-08-01T10:00:00.000Z');
    expect(rollup.lastAt).toBe('2026-08-02T09:00:00.000Z');
    expect(rollup.byModel['m1']?.totalTokens).toBe(300);
    expect(rollup.byModel['m2']?.totalTokens).toBe(50);
    expect(rollup.byDay['2026-08-01']?.totalTokens).toBe(300);
    expect(rollup.byDay['2026-08-02']?.totalTokens).toBe(50);
    expect(rollup.bySession).toHaveLength(2);
    expect(rollup.bySession[0]?.sessionId).toBe('s1');
    expect(rollup.bySession[0]?.totalTokens).toBe(300);
    expect(rollup.bySession[1]?.sessionId).toBe('s2');
  });

  it('filters by project scope, window and topSessions', async () => {
    const records = [
      record({ sessionId: 's1', projectPath: '/tmp/proj-a', totalTokens: 100, recordedAt: '2026-08-01T10:00:00.000Z' }),
      record({ sessionId: 's2', projectPath: '/tmp/proj-b', totalTokens: 50, recordedAt: '2026-08-02T10:00:00.000Z' }),
      record({ sessionId: 's3', projectPath: null, totalTokens: 25, recordedAt: '2026-08-03T10:00:00.000Z' }),
    ];
    // Project scope filter.
    const project = computeUsageRollup(records, { projectPath: '/tmp/proj-a' });
    expect(project.totalTokens).toBe(100);
    expect(project.sessionCount).toBe(1);
    // General scope filter.
    const general = computeUsageRollup(records, { scope: { kind: 'general' } });
    expect(general.totalTokens).toBe(25);
    // Window filter.
    const windowed = computeUsageRollup(records, {
      window: { from: '2026-08-02T00:00:00.000Z', to: '2026-08-02T23:59:59.999Z' },
    });
    expect(windowed.totalTokens).toBe(50);
    // topSessions limit.
    const limited = computeUsageRollup(records, { topSessions: 1 });
    expect(limited.bySession).toHaveLength(1);
  });

  it('reads rollup from disk via readUsageRollup', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'piwin-usage-'));
    const filePath = join(dir, 'ledger.jsonl');
    await appendUsageRecord(filePath, record({ totalTokens: 100 }));
    const rollup = await readUsageRollup(filePath);
    expect(rollup.totalTokens).toBe(100);
  });
});
