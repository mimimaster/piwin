import { describe, expect, it } from 'vitest';
import {
  attributeSleepEpisodeToLocalDate,
  groupSleepEpisodes,
  redactHealthRecord,
  sleepMinutesByLocalDate,
  unionIntervals,
} from './apple-health-aggregation.js';

describe('apple health aggregation', () => {
  it('unions overlapping intervals instead of summing them', () => {
    const unioned = unionIntervals([
      { startMs: 0, endMs: 60 * 60_000 },
      { startMs: 30 * 60_000, endMs: 90 * 60_000 },
    ]);
    expect(unioned).toEqual([{ startMs: 0, endMs: 90 * 60_000 }]);
  });

  it('joins gaps of at most 120 minutes into one sleep episode', () => {
    const episodes = groupSleepEpisodes([
      { startMs: 0, endMs: 60 * 60_000 },
      { startMs: 180 * 60_000, endMs: 240 * 60_000 },
    ]);
    expect(episodes).toHaveLength(1);
    expect(episodes[0]).toEqual({ startMs: 0, endMs: 240 * 60_000 });
  });

  it('attributes an episode to the local date on which it ends', () => {
    const end = Date.parse('2026-03-08T07:00:00.000Z');
    const start = end - 8 * 60 * 60_000;
    expect(attributeSleepEpisodeToLocalDate({ startMs: start, endMs: end }, 'America/New_York')).toBe(
      '2026-03-08',
    );
  });

  it('keeps DST spring-forward days as separate local dates', () => {
    const before = Date.parse('2026-03-08T06:30:00.000-05:00');
    const after = Date.parse('2026-03-08T08:30:00.000-04:00');
    const totals = sleepMinutesByLocalDate(
      [{ startMs: before, endMs: after }],
      'America/New_York',
    );
    expect([...totals.keys()]).toEqual(['2026-03-08']);
  });

  it('redacts HealthKit identifiers and source metadata', () => {
    expect(
      redactHealthRecord({
        metric: 'steps',
        value: 10,
        uuid: 'HK-1',
        sourceName: 'iPhone',
        metadata: { x: 1 },
      }),
    ).toEqual({ metric: 'steps', value: 10 });
  });
});
