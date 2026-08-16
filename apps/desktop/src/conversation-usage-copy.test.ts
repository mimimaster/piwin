import { describe, expect, it } from 'vitest';
import type { ContextUsageSnapshot } from '@piwin/contracts';
import {
  buildConversationUsageDetailRows,
  formatContextOccupancyCopy,
  formatUsageDurationMs,
  formatUsageTokenCount,
  isHostEstimatedUsage,
} from './conversation-usage-copy.js';

function createUsage(
  overrides: Partial<ContextUsageSnapshot> = {},
): ContextUsageSnapshot {
  return {
    sessionId: 'session-chat',
    tokensUsed: 12_400,
    tokensLimit: 128_000,
    updatedAt: '2026-08-16T00:00:00.000Z',
    ...overrides,
  };
}

describe('conversation usage copy', () => {
  it('formats occupancy as used / limit', () => {
    expect(formatContextOccupancyCopy(12_400, 128_000)).toBe('12K / 128K');
    expect(formatUsageTokenCount(850)).toBe('850');
    expect(formatUsageDurationMs(850)).toBe('850ms');
    expect(formatUsageDurationMs(1_200)).toBe('1.2s');
  });

  it('omits last-turn fields until Host reports them', () => {
    const rows = buildConversationUsageDetailRows({
      usage: createUsage(),
      used: 12_400,
      limit: 128_000,
    });
    expect(rows.map((row) => row.id)).toEqual(['occupied', 'limit']);
    expect(rows[0]?.value).toBe('12K');
    expect(rows[1]?.value).toBe('128K');
  });

  it('includes last-turn fields only when present and marks estimates', () => {
    expect(isHostEstimatedUsage(createUsage({ source: 'pi-contextUsage' }))).toBe(
      false,
    );
    const rows = buildConversationUsageDetailRows({
      usage: createUsage({
        source: 'host-estimate',
        promptTokens: 700,
        cacheReadTokens: 100,
        cacheWriteTokens: 50,
        completionTokens: 200,
        totalTokens: 1_050,
        durationMs: 1_200,
      }),
      used: 850,
      limit: 128_000,
      locale: 'en',
    });
    expect(rows).toEqual([
      { id: 'occupied', label: 'Context occupied', value: '~850' },
      { id: 'limit', label: 'Context limit', value: '128K' },
      { id: 'input', label: 'Input', value: '~700' },
      { id: 'cache-read', label: 'Cache read', value: '~100' },
      { id: 'cache-write', label: 'Cache write', value: '~50' },
      { id: 'output', label: 'Output', value: '~200' },
      { id: 'total', label: 'Total', value: '~1.1K' },
      { id: 'duration', label: 'Duration', value: '1.2s' },
    ]);
  });
});
