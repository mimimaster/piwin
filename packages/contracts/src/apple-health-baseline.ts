/**
 * Apple Health personal baseline contract. The device computes these from its
 * own daily values; only the statistics leave the phone, never the baseline
 * days themselves.
 */

import type { ClientToolParseResult } from './client-tool.js';
import {
  APPLE_HEALTH_CUMULATIVE_METRIC_IDS,
  SLEEP_SCHEDULE_BEDTIME_COMPONENT,
  SLEEP_SCHEDULE_WAKE_COMPONENT,
  appleHealthMetricUnit,
  isAppleHealthLocalDate,
  isAppleHealthMetricId,
  type AppleHealthMetricId,
  type AppleHealthUnit,
} from './apple-health-metrics.js';

/** Length of the trailing window a baseline is computed over. */
export const APPLE_HEALTH_BASELINE_WINDOW_DAYS = 30;
/** Fewer days with data than this is noise, not a baseline. */
export const APPLE_HEALTH_BASELINE_MIN_SAMPLE_DAYS = 7;
export const APPLE_HEALTH_MAX_BASELINES = 16;

/**
 * Metrics whose daily value is one comparable number. `workouts` and
 * `sleep-stages` are composites and `sleep-schedule` is baselined per clock
 * component instead of by its value.
 */
export const APPLE_HEALTH_BASELINE_METRIC_IDS: readonly AppleHealthMetricId[] = [
  'steps',
  'active-energy',
  'exercise-minutes',
  'sleep-duration',
  'resting-heart-rate',
  'heart-rate-variability',
  'sleep-schedule',
  'body-mass',
  'body-fat-percentage',
  'vo2-max',
  'respiratory-rate',
  'blood-oxygen',
  'wrist-temperature',
  'mindful-minutes',
  'time-in-daylight',
];

export type AppleHealthBaselineLatest = {
  localDate: string;
  value: number;
  /** Percent difference from the baseline mean; absent when the mean is zero. */
  deltaPercent?: number;
  /** Standard deviations from the mean; absent when the baseline has no spread. */
  zScore?: number;
  /** The day was still running when read, so a cumulative total is incomplete. */
  partialDay?: boolean;
};

export type AppleHealthBaseline = {
  metric: AppleHealthMetricId;
  /** Set for `sleep-schedule` only: which clock component this baseline describes. */
  component?: string;
  unit: AppleHealthUnit;
  startDate: string;
  endDateExclusive: string;
  /** Days inside the window that had data; days without data are not counted as zero. */
  sampleDays: number;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  /** The last requested day compared with this baseline. */
  latest?: AppleHealthBaselineLatest;
};

const BASELINE_METRIC_SET: ReadonlySet<string> = new Set(APPLE_HEALTH_BASELINE_METRIC_IDS);
const SLEEP_SCHEDULE_COMPONENTS: ReadonlySet<string> = new Set([
  SLEEP_SCHEDULE_BEDTIME_COMPONENT,
  SLEEP_SCHEDULE_WAKE_COMPONENT,
]);
const BASELINE_KEYS = new Set([
  'metric',
  'component',
  'unit',
  'startDate',
  'endDateExclusive',
  'sampleDays',
  'mean',
  'stdDev',
  'min',
  'max',
  'latest',
]);
const LATEST_KEYS = new Set(['localDate', 'value', 'deltaPercent', 'zScore', 'partialDay']);

export function isAppleHealthBaselineMetric(metric: AppleHealthMetricId): boolean {
  return BASELINE_METRIC_SET.has(metric);
}

export function parseAppleHealthBaselines(
  value: unknown,
  requested: ReadonlySet<string> | undefined,
): ClientToolParseResult<AppleHealthBaseline[]> {
  if (!Array.isArray(value)) {
    return fail('health baselines must be an array');
  }
  if (value.length > APPLE_HEALTH_MAX_BASELINES) {
    return fail('health baselines exceed bounds');
  }
  const seen = new Set<string>();
  const baselines: AppleHealthBaseline[] = [];
  for (const item of value) {
    const baseline = parseBaseline(item, requested);
    if (!baseline.ok) {
      return baseline;
    }
    const key = `${baseline.value.metric}:${baseline.value.component ?? ''}`;
    if (seen.has(key)) {
      return fail('health baselines must be unique per metric and component');
    }
    seen.add(key);
    baselines.push(baseline.value);
  }
  return { ok: true, value: baselines };
}

function parseBaseline(
  value: unknown,
  requested: ReadonlySet<string> | undefined,
): ClientToolParseResult<AppleHealthBaseline> {
  if (!isPlainRecord(value)) {
    return fail('health baseline must be a plain object');
  }
  if (Object.keys(value).some((key) => !BASELINE_KEYS.has(key))) {
    return fail('health baseline has unknown fields');
  }
  if (
    typeof value.metric !== 'string' ||
    !isAppleHealthMetricId(value.metric) ||
    !isAppleHealthBaselineMetric(value.metric)
  ) {
    return fail('health baseline metric is invalid');
  }
  const metric = value.metric;
  if (requested && !requested.has(metric)) {
    return fail('health baseline metric was not requested');
  }
  const isSchedule = metric === 'sleep-schedule';
  if (isSchedule !== (value.component !== undefined)) {
    return fail('health baseline component is required for sleep-schedule only');
  }
  if (
    value.component !== undefined &&
    (typeof value.component !== 'string' || !SLEEP_SCHEDULE_COMPONENTS.has(value.component))
  ) {
    return fail('health baseline component is not allowlisted');
  }
  const unit = appleHealthMetricUnit(metric);
  if (value.unit !== unit) {
    return fail('health baseline unit does not match metric');
  }
  if (
    typeof value.startDate !== 'string' ||
    typeof value.endDateExclusive !== 'string' ||
    !isAppleHealthLocalDate(value.startDate) ||
    !isAppleHealthLocalDate(value.endDateExclusive) ||
    value.startDate >= value.endDateExclusive
  ) {
    return fail('health baseline window is invalid');
  }
  if (
    typeof value.sampleDays !== 'number' ||
    !Number.isSafeInteger(value.sampleDays) ||
    value.sampleDays < APPLE_HEALTH_BASELINE_MIN_SAMPLE_DAYS ||
    value.sampleDays > APPLE_HEALTH_BASELINE_WINDOW_DAYS
  ) {
    return fail('health baseline sampleDays is out of range');
  }
  if (
    !isNonNegativeFinite(value.mean) ||
    !isNonNegativeFinite(value.stdDev) ||
    !isNonNegativeFinite(value.min) ||
    !isNonNegativeFinite(value.max) ||
    value.min > value.mean ||
    value.mean > value.max
  ) {
    return fail('health baseline statistics are invalid');
  }
  const baseline: AppleHealthBaseline = {
    metric,
    unit,
    startDate: value.startDate,
    endDateExclusive: value.endDateExclusive,
    sampleDays: value.sampleDays,
    mean: value.mean,
    stdDev: value.stdDev,
    min: value.min,
    max: value.max,
  };
  if (typeof value.component === 'string') {
    baseline.component = value.component;
  }
  if (value.latest !== undefined) {
    const latest = parseLatest(value.latest, metric);
    if (!latest.ok) {
      return latest;
    }
    baseline.latest = latest.value;
  }
  return { ok: true, value: baseline };
}

function parseLatest(
  value: unknown,
  metric: AppleHealthMetricId,
): ClientToolParseResult<AppleHealthBaselineLatest> {
  if (!isPlainRecord(value)) {
    return fail('health baseline latest must be a plain object');
  }
  if (Object.keys(value).some((key) => !LATEST_KEYS.has(key))) {
    return fail('health baseline latest has unknown fields');
  }
  if (typeof value.localDate !== 'string' || !isAppleHealthLocalDate(value.localDate)) {
    return fail('health baseline latest localDate is invalid');
  }
  if (!isNonNegativeFinite(value.value)) {
    return fail('health baseline latest value is invalid');
  }
  const latest: AppleHealthBaselineLatest = { localDate: value.localDate, value: value.value };
  if (value.deltaPercent !== undefined) {
    if (typeof value.deltaPercent !== 'number' || !Number.isFinite(value.deltaPercent)) {
      return fail('health baseline latest deltaPercent is invalid');
    }
    latest.deltaPercent = value.deltaPercent;
  }
  if (value.zScore !== undefined) {
    if (typeof value.zScore !== 'number' || !Number.isFinite(value.zScore)) {
      return fail('health baseline latest zScore is invalid');
    }
    latest.zScore = value.zScore;
  }
  if (value.partialDay !== undefined) {
    if (value.partialDay !== true || !APPLE_HEALTH_CUMULATIVE_METRIC_IDS.includes(metric)) {
      return fail('health baseline latest partialDay is only valid for cumulative metrics');
    }
    latest.partialDay = true;
  }
  return { ok: true, value: latest };
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
