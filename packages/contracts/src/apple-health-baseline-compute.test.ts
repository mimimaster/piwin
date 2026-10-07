import { describe, expect, it } from 'vitest';
import {
  computeHealthBaselines,
  SLEEP_SCHEDULE_BEDTIME_COMPONENT,
  SLEEP_SCHEDULE_WAKE_COMPONENT,
  type AppleHealthMetricId,
  type AppleHealthRecord,
} from './apple-health.js';

const FRESH = '2026-10-07T04:00:00.000Z';
const WINDOW = { startDate: '2026-09-07', endDateExclusive: '2026-10-07' };

function day(offset: number): string {
  return new Date(Date.UTC(2026, 8, 7 + offset)).toISOString().slice(0, 10);
}

function daily(
  metric: AppleHealthMetricId,
  unit: AppleHealthRecord['unit'],
  values: readonly number[],
): AppleHealthRecord[] {
  return values.map((value, index) => ({
    metric,
    localDate: day(index),
    unit,
    value,
    freshAsOf: FRESH,
  }));
}

describe('computeHealthBaselines', () => {
  it('reports mean, spread and how the latest day deviates', () => {
    const [baseline] = computeHealthBaselines({
      metrics: ['resting-heart-rate'],
      baselineRecords: daily('resting-heart-rate', 'bpm', [54, 56, 58, 56, 54, 58, 56, 56]),
      records: [
        { metric: 'resting-heart-rate', localDate: '2026-10-07', unit: 'bpm', value: 62, freshAsOf: FRESH },
      ],
      window: WINDOW,
      latestLocalDate: '2026-10-07',
      todayLocalDate: '2026-10-07',
    });
    expect(baseline).toMatchObject({
      metric: 'resting-heart-rate',
      unit: 'bpm',
      sampleDays: 8,
      mean: 56,
      stdDev: 1.51,
      min: 54,
      max: 58,
      latest: { localDate: '2026-10-07', value: 62, deltaPercent: 10.71, zScore: 3.97 },
    });
    expect(baseline?.latest?.partialDay).toBeUndefined();
  });

  it('flags a cumulative total for today as a partial day', () => {
    const [baseline] = computeHealthBaselines({
      metrics: ['steps'],
      baselineRecords: daily('steps', 'count', [8000, 9000, 7000, 8000, 8500, 7500, 8000]),
      records: [{ metric: 'steps', localDate: '2026-10-07', unit: 'count', value: 2000, freshAsOf: FRESH }],
      window: WINDOW,
      latestLocalDate: '2026-10-07',
      todayLocalDate: '2026-10-07',
    });
    expect(baseline?.latest).toMatchObject({ value: 2000, deltaPercent: -75, partialDay: true });
  });

  it('gives no baseline below seven days of data and never counts a missing day as zero', () => {
    const baselines = computeHealthBaselines({
      metrics: ['steps', 'body-mass'],
      baselineRecords: [
        ...daily('steps', 'count', [8000, 9000, 7000, 8000, 8500, 7500]),
        ...daily('body-mass', 'kg', [70, 70.4, 70.2, 70.1, 70.3, 70.2, 70.2]),
      ],
      records: [],
      window: WINDOW,
      latestLocalDate: '2026-10-07',
      todayLocalDate: '2026-10-07',
    });
    expect(baselines.map((baseline) => baseline.metric)).toEqual(['body-mass']);
    expect(baselines[0]?.sampleDays).toBe(7);
    expect(baselines[0]?.latest).toBeUndefined();
  });

  it('ignores days outside the window, hourly buckets and composite metrics', () => {
    const baselines = computeHealthBaselines({
      metrics: ['steps', 'workouts'],
      baselineRecords: [
        ...daily('steps', 'count', [8000, 8000, 8000, 8000, 8000, 8000, 8000]),
        { metric: 'steps', localDate: '2026-10-07', unit: 'count', value: 90000, freshAsOf: FRESH },
        { metric: 'steps', localDate: day(0), localHour: 9, unit: 'count', value: 90000, freshAsOf: FRESH },
        ...daily('workouts', 'minute', [30, 30, 30, 30, 30, 30, 30]),
      ],
      records: [],
      window: WINDOW,
      latestLocalDate: '2026-10-07',
      todayLocalDate: '2026-10-07',
    });
    expect(baselines).toHaveLength(1);
    expect(baselines[0]).toMatchObject({ metric: 'steps', mean: 8000, stdDev: 0, sampleDays: 7 });
  });

  it('baselines bedtime and wake time separately for sleep-schedule', () => {
    const nights: AppleHealthRecord[] = [690, 700, 710, 680, 695, 705, 720].map((bedtime, index) => ({
      metric: 'sleep-schedule',
      localDate: day(index),
      unit: 'minute',
      value: 460,
      components: {
        [SLEEP_SCHEDULE_BEDTIME_COMPONENT]: bedtime,
        [SLEEP_SCHEDULE_WAKE_COMPONENT]: 430,
      },
      freshAsOf: FRESH,
    }));
    const baselines = computeHealthBaselines({
      metrics: ['sleep-schedule'],
      baselineRecords: nights,
      records: [
        {
          metric: 'sleep-schedule',
          localDate: '2026-10-07',
          unit: 'minute',
          value: 360,
          components: {
            [SLEEP_SCHEDULE_BEDTIME_COMPONENT]: 800,
            [SLEEP_SCHEDULE_WAKE_COMPONENT]: 440,
          },
          freshAsOf: FRESH,
        },
      ],
      window: WINDOW,
      latestLocalDate: '2026-10-07',
      todayLocalDate: '2026-10-07',
    });
    expect(baselines.map((baseline) => baseline.component)).toEqual([
      SLEEP_SCHEDULE_BEDTIME_COMPONENT,
      SLEEP_SCHEDULE_WAKE_COMPONENT,
    ]);
    expect(baselines[0]).toMatchObject({ mean: 700, latest: { value: 800 } });
    expect(baselines[1]).toMatchObject({ mean: 430, stdDev: 0, latest: { value: 440 } });
    expect(baselines[1]?.latest?.zScore).toBeUndefined();
  });
});
