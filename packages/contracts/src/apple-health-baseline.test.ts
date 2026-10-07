import { describe, expect, it } from 'vitest';
import {
  parseAppleHealthReadResultV1,
  parseHealthReadContextArguments,
  SLEEP_SCHEDULE_BEDTIME_COMPONENT,
  SLEEP_SCHEDULE_WAKE_COMPONENT,
} from './apple-health.js';

const GENERATED_AT = '2026-10-07T04:00:00.000Z';

function result(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: 1,
    source: 'apple-health',
    timeZone: 'Asia/Shanghai',
    startAt: '2026-10-06T16:00:00.000Z',
    endAt: '2026-10-07T16:00:00.000Z',
    generatedAt: GENERATED_AT,
    records: [],
    unavailableMetrics: [],
    warnings: [],
    ...overrides,
  };
}

function stepsBaseline(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    metric: 'steps',
    unit: 'count',
    startDate: '2026-09-07',
    endDateExclusive: '2026-10-07',
    sampleDays: 28,
    mean: 8000,
    stdDev: 1500,
    min: 4200,
    max: 12100,
    latest: { localDate: '2026-10-07', value: 3100, deltaPercent: -61.25, zScore: -3.27, partialDay: true },
    ...overrides,
  };
}

describe('apple health hour granularity', () => {
  it('accepts hour granularity for today only and without a comparison period', () => {
    expect(
      parseHealthReadContextArguments({
        metrics: ['steps'],
        range: { preset: 'today' },
        granularity: 'hour',
      }).ok,
    ).toBe(true);
    expect(
      parseHealthReadContextArguments({
        metrics: ['steps'],
        range: { preset: 'last-7-days' },
        granularity: 'hour',
      }).ok,
    ).toBe(false);
    expect(
      parseHealthReadContextArguments({
        metrics: ['steps'],
        range: { preset: 'today' },
        granularity: 'hour',
        includePreviousPeriod: true,
      }).ok,
    ).toBe(false);
  });

  it('keeps a day total and its hourly buckets apart, and rejects a repeated hour', () => {
    const hourly = (localHour: number, value: number) => ({
      metric: 'steps',
      localDate: '2026-10-07',
      localHour,
      unit: 'count',
      value,
      freshAsOf: GENERATED_AT,
    });
    const total = { metric: 'steps', localDate: '2026-10-07', unit: 'count', value: 900, freshAsOf: GENERATED_AT };
    const parsed = parseAppleHealthReadResultV1(result({ records: [total, hourly(8, 400), hourly(9, 500)] }));
    expect(parsed.ok && parsed.value.records.map((record) => record.localHour)).toEqual([undefined, 8, 9]);
    expect(parseAppleHealthReadResultV1(result({ records: [hourly(8, 400), hourly(8, 1)] })).ok).toBe(false);
    expect(parseAppleHealthReadResultV1(result({ records: [hourly(24, 1)] })).ok).toBe(false);
  });

  it('rejects hourly buckets for a metric that is not summed', () => {
    const parsed = parseAppleHealthReadResultV1(
      result({
        records: [
          { metric: 'resting-heart-rate', localDate: '2026-10-07', localHour: 8, unit: 'bpm', value: 58, freshAsOf: GENERATED_AT },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
  });
});

describe('apple health sleep schedule', () => {
  it('accepts only the two clock components', () => {
    const record = (components: Record<string, number>) => ({
      metric: 'sleep-schedule',
      localDate: '2026-10-07',
      unit: 'minute',
      value: 465,
      components,
      freshAsOf: GENERATED_AT,
    });
    expect(
      parseAppleHealthReadResultV1(
        result({
          records: [
            record({ [SLEEP_SCHEDULE_BEDTIME_COMPONENT]: 690, [SLEEP_SCHEDULE_WAKE_COMPONENT]: 435 }),
          ],
        }),
      ).ok,
    ).toBe(true);
    expect(parseAppleHealthReadResultV1(result({ records: [record({ deep: 60 })] })).ok).toBe(false);
  });
});

describe('apple health baselines', () => {
  it('parses a baseline with its latest-day comparison', () => {
    const parsed = parseAppleHealthReadResultV1(result({ baselines: [stepsBaseline()] }), {
      requestedMetrics: ['steps'],
    });
    expect(parsed.ok && parsed.value.baselines?.[0]).toMatchObject({
      metric: 'steps',
      sampleDays: 28,
      latest: { deltaPercent: -61.25, partialDay: true },
    });
  });

  it('omits baselines entirely when the device sent none', () => {
    const parsed = parseAppleHealthReadResultV1(result({}));
    expect(parsed.ok && 'baselines' in parsed.value).toBe(false);
  });

  it('rejects baselines that are unrequested, too thin, composite, or carry raw days', () => {
    const reject = (baseline: Record<string, unknown>, requested = ['steps', 'workouts', 'sleep-schedule']) =>
      parseAppleHealthReadResultV1(result({ baselines: [baseline] }), {
        requestedMetrics: requested as never,
      }).ok;
    expect(reject(stepsBaseline(), ['sleep-duration'])).toBe(false);
    expect(reject(stepsBaseline({ sampleDays: 3 }))).toBe(false);
    expect(reject(stepsBaseline({ metric: 'workouts', unit: 'minute' }))).toBe(false);
    expect(reject(stepsBaseline({ samples: [1, 2, 3] }))).toBe(false);
    expect(reject(stepsBaseline({ unit: 'kcal' }))).toBe(false);
    expect(reject(stepsBaseline({ min: 9000 }))).toBe(false);
    expect(reject(stepsBaseline({ component: SLEEP_SCHEDULE_WAKE_COMPONENT }))).toBe(false);
  });

  it('requires a clock component on sleep-schedule baselines and one baseline per component', () => {
    const schedule = (component?: string) => ({
      metric: 'sleep-schedule',
      unit: 'minute',
      startDate: '2026-09-07',
      endDateExclusive: '2026-10-07',
      sampleDays: 25,
      mean: 700,
      stdDev: 35,
      min: 640,
      max: 790,
      ...(component === undefined ? {} : { component }),
    });
    const parse = (baselines: unknown[]) =>
      parseAppleHealthReadResultV1(result({ baselines }), { requestedMetrics: ['sleep-schedule'] }).ok;
    expect(parse([schedule(SLEEP_SCHEDULE_BEDTIME_COMPONENT), schedule(SLEEP_SCHEDULE_WAKE_COMPONENT)])).toBe(true);
    expect(parse([schedule()])).toBe(false);
    expect(parse([schedule(SLEEP_SCHEDULE_WAKE_COMPONENT), schedule(SLEEP_SCHEDULE_WAKE_COMPONENT)])).toBe(false);
  });

  it('marks partialDay only on metrics that are summed over the day', () => {
    const parsed = parseAppleHealthReadResultV1(
      result({
        baselines: [
          {
            metric: 'resting-heart-rate',
            unit: 'bpm',
            startDate: '2026-09-07',
            endDateExclusive: '2026-10-07',
            sampleDays: 30,
            mean: 56,
            stdDev: 2,
            min: 52,
            max: 61,
            latest: { localDate: '2026-10-07', value: 60, partialDay: true },
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(false);
  });
});
