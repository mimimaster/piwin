import { describe, expect, it } from 'vitest';
import type { UsageRecord } from '@piwin/contracts';
import { computeUsageRollup } from './usage-ledger-store.js';
import { computeUsageCallLog } from './usage-call-log.js';

const now = new Date('2026-11-05T12:00:00Z');
function row(modelId: string, overrides: Partial<UsageRecord> = {}): UsageRecord {
  return { sessionId: modelId, projectPath: '/project', modelId, providerId: 'key',
    recordedAt: '2026-11-05T11:30:00Z', source: 'assistant-usage',
    promptTokens: 60, completionTokens: 40, totalTokens: 100, ...overrides };
}
const estimateCost = (record: UsageRecord) => record.providerId === 'unknown' ? undefined : { usd: 0.1, reference: `catalog/${record.modelId}` };

describe('usage model filter', () => {
  it('filters before aggregating costs, sessions and daily totals, across Keys', () => {
    const records = [row('chosen'), row('chosen', { sessionId: 'second', providerId: 'unknown' }),
      row('other'), row('chosen', { projectPath: '/outside' }),
      row('historical', { recordedAt: '2025-01-01T00:00:00Z' })];
    const rollup = computeUsageRollup(records, { projectPath: '/project', modelId: 'chosen',
      window: { from: '2026-11-01' }, estimateCost });
    expect(rollup).toMatchObject({ totalTokens: 200, entryCount: 2, sessionCount: 2,
      estimatedCostUsd: 0.1, pricedEntryCount: 1, availableModels: ['chosen', 'historical', 'other'] });
    expect(Object.keys(rollup.byModel)).toEqual(['chosen']);
    expect(rollup.byDay['2026-11-05']).toMatchObject({ totalTokens: 200, estimatedCostUsd: 0.1 });
    expect(rollup.byModelKey).toHaveLength(2);
  });

  it('returns empty statistics for a model without matches', () => {
    const rollup = computeUsageRollup([row('other')], { modelId: 'missing', estimateCost });
    expect(rollup).toMatchObject({ entryCount: 0, sessionCount: 0, totalTokens: 0, pricedEntryCount: 0 });
  });

  it('filters recent calls before pagination and window-wide totals', () => {
    const log = computeUsageCallLog([row('chosen'), row('other'), row('chosen', { providerId: 'second' })],
      { now, modelId: 'chosen', limit: 1, offset: 1, estimateCost });
    expect(log).toMatchObject({ totalInWindow: 2, offset: 1, windowSummary: { totalTokens: 200 } });
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.modelId).toBe('chosen');
    expect(log.entries[0]?.cost?.usd).toBe(0.1);
  });

  it('applies the filter after backend request details replace their turn rows', () => {
    const log = computeUsageCallLog([row('chosen', { sessionId: 'backend' })], {
      now, modelId: 'chosen', requestRecords: [row('other', { sessionId: 'backend' })],
    });
    expect(log.totalInWindow).toBe(0);
  });
});
