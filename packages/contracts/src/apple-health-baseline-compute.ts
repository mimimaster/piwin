/**
 * Personal baseline statistics from daily values. On the phone this runs over
 * days that never leave it; on the Host it runs over the summaries the user
 * chose to store. Pure, so both sides share one definition of "baseline".
 */
import type { AppleHealthRecord } from './apple-health.js';
import {
  APPLE_HEALTH_BASELINE_MIN_SAMPLE_DAYS,
  isAppleHealthBaselineMetric,
  type AppleHealthBaseline,
  type AppleHealthBaselineLatest,
} from './apple-health-baseline.js';
import {
  APPLE_HEALTH_CUMULATIVE_METRIC_IDS,
  SLEEP_SCHEDULE_BEDTIME_COMPONENT,
  SLEEP_SCHEDULE_WAKE_COMPONENT,
  appleHealthMetricUnit,
  type AppleHealthMetricId,
} from './apple-health-metrics.js';

export type HealthBaselineWindow = {
  startDate: string;
  endDateExclusive: string;
};

export type ComputeHealthBaselinesInput = {
  metrics: readonly AppleHealthMetricId[];
  /** Daily records inside the baseline window. */
  baselineRecords: readonly AppleHealthRecord[];
  /** Records being returned; the comparison day is looked up here. */
  records: readonly AppleHealthRecord[];
  window: HealthBaselineWindow;
  /** The last requested local day, compared against the baseline. */
  latestLocalDate: string;
  /** Today on the device; a cumulative total for it is still incomplete. */
  todayLocalDate: string;
};

const SLEEP_SCHEDULE_COMPONENTS = [
  SLEEP_SCHEDULE_BEDTIME_COMPONENT,
  SLEEP_SCHEDULE_WAKE_COMPONENT,
] as const;

export function computeHealthBaselines(input: ComputeHealthBaselinesInput): AppleHealthBaseline[] {
  const baselines: AppleHealthBaseline[] = [];
  for (const metric of input.metrics) {
    if (!isAppleHealthBaselineMetric(metric)) {
      continue;
    }
    const components = metric === 'sleep-schedule' ? SLEEP_SCHEDULE_COMPONENTS : [undefined];
    for (const component of components) {
      const baseline = computeBaseline(input, metric, component);
      if (baseline !== undefined) {
        baselines.push(baseline);
      }
    }
  }
  return baselines;
}

function computeBaseline(
  input: ComputeHealthBaselinesInput,
  metric: AppleHealthMetricId,
  component: string | undefined,
): AppleHealthBaseline | undefined {
  const samples: number[] = [];
  for (const record of input.baselineRecords) {
    if (
      record.metric !== metric ||
      record.localHour !== undefined ||
      record.localDate < input.window.startDate ||
      record.localDate >= input.window.endDateExclusive
    ) {
      continue;
    }
    const sample = sampleValue(record, component);
    if (sample !== undefined) {
      samples.push(sample);
    }
  }
  if (samples.length < APPLE_HEALTH_BASELINE_MIN_SAMPLE_DAYS) {
    return undefined;
  }
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance =
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (samples.length - 1);
  const stdDev = Math.sqrt(variance);
  const baseline: AppleHealthBaseline = {
    metric,
    unit: appleHealthMetricUnit(metric),
    startDate: input.window.startDate,
    endDateExclusive: input.window.endDateExclusive,
    sampleDays: samples.length,
    mean: round2(mean),
    stdDev: round2(stdDev),
    min: round2(Math.min(...samples)),
    max: round2(Math.max(...samples)),
  };
  if (component !== undefined) {
    baseline.component = component;
  }
  const latestRecord = input.records.find(
    (record) =>
      record.metric === metric &&
      record.localHour === undefined &&
      record.localDate === input.latestLocalDate,
  );
  const latestValue = latestRecord === undefined ? undefined : sampleValue(latestRecord, component);
  if (latestValue !== undefined) {
    const latest: AppleHealthBaselineLatest = {
      localDate: input.latestLocalDate,
      value: round2(latestValue),
    };
    if (mean > 0) {
      latest.deltaPercent = round2(((latestValue - mean) / mean) * 100);
    }
    if (stdDev > 0) {
      latest.zScore = round2((latestValue - mean) / stdDev);
    }
    if (
      input.latestLocalDate === input.todayLocalDate &&
      APPLE_HEALTH_CUMULATIVE_METRIC_IDS.includes(metric)
    ) {
      latest.partialDay = true;
    }
    baseline.latest = latest;
  }
  return baseline;
}

function sampleValue(record: AppleHealthRecord, component: string | undefined): number | undefined {
  const value = component === undefined ? record.value : record.components?.[component];
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
