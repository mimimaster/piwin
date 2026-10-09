import { describe, expect, it } from 'vitest';
import type { UsageCostEstimate, UsageRecord } from '@piwin/contracts';
import { computeUsageRollup } from './usage-ledger-store.js';
import { computeUsageCallLog } from './usage-call-log.js';

function row(partial: Partial<UsageRecord> = {}): UsageRecord {
  return {
    sessionId: 'parent', projectPath: '/project', providerId: 'key', modelId: 'model',
    measurementId: 'a', recordedAt: '2026-10-09T10:00:00Z', source: 'assistant-usage',
    promptTokens: 50, completionTokens: 50, totalTokens: 100, ...partial,
  };
}
const estimateCost = (record: UsageRecord): UsageCostEstimate | undefined =>
  record.modelId === 'unknown' ? undefined : { usd: record.modelId === 'free' ? 0 : 0.1, reference: `catalog/${record.modelId}` };

describe('read-side usage reference costs', () => {
  it('deduplicates and sums known cost in every dimension, including child sessions', () => {
    const records = [row(), row(), row({ sessionId: 'child', measurementId: 'b' }),
      row({ measurementId: 'c', modelId: 'unknown' }), row({ measurementId: 'd', modelId: 'free' })];
    const rollup = computeUsageRollup(records, { estimateCost });
    expect(rollup.entryCount).toBe(4);
    expect(rollup.estimatedCostUsd).toBeCloseTo(0.2);
    expect(rollup.pricedEntryCount).toBe(3);
    expect(rollup.byModel['model']).toMatchObject({ estimatedCostUsd: 0.2, pricedEntryCount: 2 });
    expect(rollup.byModel['free']).toMatchObject({ estimatedCostUsd: 0, pricedEntryCount: 1 });
    expect(rollup.byModel['unknown']?.estimatedCostUsd).toBeUndefined();
    expect(rollup.byModelKey.find((bucket) => bucket.modelId === 'model'))
      .toMatchObject({ costReference: 'catalog/model', estimatedCostUsd: 0.2 });
    expect(rollup.byDay['2026-10-09']).toMatchObject({ estimatedCostUsd: 0.2, pricedEntryCount: 3 });
    expect(rollup.bySession.find((bucket) => bucket.sessionId === 'child'))
      .toMatchObject({ estimatedCostUsd: 0.1, pricedEntryCount: 1 });
    expect(records.every((record) => !('cost' in record))).toBe(true);
  });

  it('respects scope and time filters before estimating or summing cost', () => {
    const records = [row(), row({ projectPath: '/other', measurementId: 'other' }),
      row({ recordedAt: '2025-01-01T00:00:00Z', measurementId: 'old' })];
    const rollup = computeUsageRollup(records, {
      projectPath: '/project', window: { from: '2026-01-01' }, estimateCost,
    });
    expect(rollup.entryCount).toBe(1);
    expect(rollup.estimatedCostUsd).toBe(0.1);
  });

  it('does not label an entirely unpriced ledger as zero dollars', () => {
    const rollup = computeUsageRollup([row({ modelId: 'unknown' })], { estimateCost });
    expect(rollup.pricedEntryCount).toBe(0);
    expect(rollup.estimatedCostUsd).toBeUndefined();
    expect(computeUsageRollup([row()]).estimatedCostUsd).toBeUndefined();
  });

  it('prices paged backend details, without counting their turn fallback twice', () => {
    const log = computeUsageCallLog([row()], {
      now: new Date('2026-10-09T10:01:00Z'), estimateCost, limit: 1,
      requestRecords: [row({ measurementId: 'request1' }), row({ measurementId: 'request2' })],
    });
    expect(log.totalInWindow).toBe(2);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.cost).toEqual({ usd: 0.1, reference: 'catalog/model' });
    expect(computeUsageCallLog([row({ modelId: 'unknown' })], {
      now: new Date('2026-10-09T10:01:00Z'), estimateCost,
    }).entries[0]?.cost).toBeUndefined();
  });
});
