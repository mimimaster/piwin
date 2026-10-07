/**
 * Apple Health metric allowlist: ids, canonical units, and the shape rules
 * shared by the read contract and the baseline contract.
 */

export const APPLE_HEALTH_METRIC_IDS = [
  'steps',
  'active-energy',
  'exercise-minutes',
  'workouts',
  'sleep-duration',
  'sleep-stages',
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
] as const;

export type AppleHealthMetricId = (typeof APPLE_HEALTH_METRIC_IDS)[number];

export type AppleHealthUnit =
  | 'count'
  | 'kcal'
  | 'minute'
  | 'bpm'
  | 'ms'
  | 'kg'
  | 'percent'
  | 'ml/kg/min'
  | 'breaths/min'
  | 'degC';

/**
 * Metrics HealthKit sums over an interval. Only these have hourly buckets, and
 * only these are incomplete while the day is still running.
 */
export const APPLE_HEALTH_CUMULATIVE_METRIC_IDS: readonly AppleHealthMetricId[] = [
  'steps',
  'active-energy',
  'exercise-minutes',
  'mindful-minutes',
  'time-in-daylight',
];

const METRIC_SET: ReadonlySet<string> = new Set(APPLE_HEALTH_METRIC_IDS);

const METRIC_UNITS: Record<AppleHealthMetricId, AppleHealthUnit> = {
  steps: 'count',
  'active-energy': 'kcal',
  'exercise-minutes': 'minute',
  workouts: 'minute',
  'sleep-duration': 'minute',
  'sleep-stages': 'minute',
  'resting-heart-rate': 'bpm',
  'heart-rate-variability': 'ms',
  'sleep-schedule': 'minute',
  'body-mass': 'kg',
  'body-fat-percentage': 'percent',
  'vo2-max': 'ml/kg/min',
  'respiratory-rate': 'breaths/min',
  'blood-oxygen': 'percent',
  'wrist-temperature': 'degC',
  'mindful-minutes': 'minute',
  'time-in-daylight': 'minute',
};

/**
 * `sleep-schedule` clock components for the main sleep episode of a night.
 * Bedtime counts minutes from noon of the previous local day so that times on
 * both sides of midnight stay ordered and averageable (23:30 → 690, 01:00 → 780).
 */
export const SLEEP_SCHEDULE_BEDTIME_COMPONENT = 'bedtime-minutes-after-noon';
export const SLEEP_SCHEDULE_WAKE_COMPONENT = 'wake-minute-of-day';

export function isAppleHealthMetricId(value: string): value is AppleHealthMetricId {
  return METRIC_SET.has(value);
}

export function appleHealthMetricUnit(metric: AppleHealthMetricId): AppleHealthUnit {
  return METRIC_UNITS[metric];
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written as YYYY-MM-DD. */
export function isAppleHealthLocalDate(value: string): boolean {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
