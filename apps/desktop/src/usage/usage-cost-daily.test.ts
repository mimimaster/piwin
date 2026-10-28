import { describe, expect, it } from 'vitest';
import type { UsageBucket } from '@piwin/contracts';
import { buildUsageCostSeries, formatUsageDayKey, niceCeiling } from './usage-cost-daily';

function day(cost: number | undefined, calls = 1, priced = calls): UsageBucket {
  return {
    promptTokens: 0, completionTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, entryCount: calls,
    ...(cost !== undefined ? { estimatedCostUsd: cost, pricedEntryCount: priced } : { pricedEntryCount: 0 }),
  };
}

describe('buildUsageCostSeries', () => {
  it('fills quiet days in the window with zero bars', () => {
    const series = buildUsageCostSeries(
      { '2026-10-02': day(3), '2026-10-04': day(7) },
      { startDay: '2026-10-01', endDay: '2026-10-05' },
    );
    expect(series.bars.map((bar) => bar.costUsd)).toEqual([0, 3, 0, 7, 0]);
    expect(series.dayCount).toBe(5);
    expect(series.bucketDays).toBe(1);
    expect(series.peak?.start).toBe('2026-10-04');
    expect(series.axisMaxUsd).toBe(10);
  });

  it('marks a day with calls but no price as unknown, not zero', () => {
    const series = buildUsageCostSeries({ '2026-10-01': day(undefined, 4) });
    expect(series.bars).toEqual([{ start: '2026-10-01', end: '2026-10-01', costUsd: undefined, calls: 4 }]);
    expect(series.axisMaxUsd).toBe(0);
  });

  it('defaults the range to the recorded days and ignores days outside the window', () => {
    const series = buildUsageCostSeries(
      { '2026-09-01': day(100), '2026-10-01': day(1), '2026-10-03': day(2) },
      { startDay: '2026-10-01' },
    );
    expect(series.bars.map((bar) => bar.start)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03']);
  });

  it('folds long ranges into weekly bars', () => {
    const series = buildUsageCostSeries(
      { '2026-01-01': day(1), '2026-01-07': day(2), '2026-01-08': day(4) },
      { startDay: '2026-01-01', endDay: '2026-06-30' },
    );
    expect(series.bucketDays).toBe(7);
    expect(series.bars[0]).toMatchObject({ start: '2026-01-01', end: '2026-01-07', costUsd: 3, calls: 2 });
    expect(series.bars[1]?.costUsd).toBe(4);
    expect(series.bars.at(-1)?.end).toBe('2026-06-30');
  });

  it('returns an empty series without days', () => {
    expect(buildUsageCostSeries({}).bars).toEqual([]);
    expect(buildUsageCostSeries({}, { startDay: '2026-10-05', endDay: '2026-10-01' }).bars).toEqual([]);
  });
});

describe('niceCeiling', () => {
  it('rounds axis maxima to short labels', () => {
    expect(niceCeiling(0)).toBe(0);
    expect(niceCeiling(0.032)).toBe(0.05);
    expect(niceCeiling(187)).toBe(200);
    expect(niceCeiling(212)).toBe(250);
    expect(niceCeiling(1000)).toBe(1000);
  });
});

describe('formatUsageDayKey', () => {
  it('formats in the requested zone', () => {
    const instant = new Date('2026-10-01T20:00:00Z');
    expect(formatUsageDayKey(instant, 'UTC')).toBe('2026-10-01');
    expect(formatUsageDayKey(instant, 'Asia/Shanghai')).toBe('2026-10-02');
  });
});
