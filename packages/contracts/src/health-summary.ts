/**
 * Background health summaries (ADR 0062 M2): the batch a paired phone uploads,
 * the Host-side settings that decide whether it is kept, and the scheduled
 * digest that reads what was kept.
 */

import type { ClientToolParseResult } from './client-tool.js';
import type { ModelRef } from './host.js';
import {
  APPLE_HEALTH_MAX_METRICS_PER_CALL,
  parseAppleHealthRecords,
  type AppleHealthRecord,
} from './apple-health.js';
import {
  APPLE_HEALTH_METRIC_IDS,
  isAppleHealthLocalDate,
  isAppleHealthMetricId,
  type AppleHealthMetricId,
} from './apple-health-metrics.js';

export const HEALTH_SUMMARY_SYNC_PATH = '/v1/device-health/summaries:sync';
export const HEALTH_SUMMARY_DELETE_PATH = '/v1/device-health/summaries';
export const HEALTH_SUMMARY_MAX_BATCH_BYTES = 262_144;
/** A batch recomputes whole local days; this bounds how far back one reaches. */
export const HEALTH_SUMMARY_MAX_WINDOW_DAYS = 90;
export const HEALTH_SUMMARY_DEFAULT_RETENTION_DAYS = 90;
export const HEALTH_SUMMARY_MAX_RETENTION_DAYS = 365;
export const HEALTH_SUMMARY_DEVICE_ID_HEADER = 'x-piwin-device-id';

/**
 * One upload from the phone. The phone recomputes every listed metric for
 * every local day of the window, so the batch replaces that window outright:
 * a day with no record in it has no data any more.
 */
export type HealthSummarySyncBatchV1 = {
  schemaVersion: 1;
  batchId: string;
  generatedAt: string;
  timeZone: string;
  startDate: string;
  endDateExclusive: string;
  metrics: AppleHealthMetricId[];
  /** Daily records only; hourly buckets are never stored. */
  records: AppleHealthRecord[];
};

export type HealthSummarySyncResult = {
  /** False when a newer batch already covered this window. */
  applied: boolean;
  storedRecords: number;
};

export type HealthSummaryDeviceStatus = {
  deviceId: string;
  lastSyncAt: string;
  timeZone: string;
  recordCount: number;
  oldestLocalDate?: string;
  newestLocalDate?: string;
};

export type HealthDigestRunStatus = {
  lastRunAt?: string;
  lastStatus?: 'ok' | 'error' | 'skipped';
  lastMessage?: string;
  lastSessionId?: string;
};

export type HealthSummaryStatus = {
  storageEnabled: boolean;
  devices: HealthSummaryDeviceStatus[];
  digest: HealthDigestRunStatus & { enabled: boolean };
};

/** What the Host HTTP ingress needs; implemented by the Host runtime. */
export interface HealthSummarySyncPort {
  /** Whether the user turned Host-side storage on. */
  isStorageEnabled(): Promise<boolean>;
  sync(deviceId: string, batch: HealthSummarySyncBatchV1): Promise<HealthSummarySyncResult>;
  deleteDevice(deviceId: string): Promise<void>;
}

export type HealthDigestCadence = 'daily' | 'weekly';

export type HealthDigestConfig = {
  enabled: boolean;
  /** Chosen by the user; the digest never falls back to another model. */
  model: ModelRef | null;
  cadence: HealthDigestCadence;
  /** Host-local wall clock, `HH:MM`. */
  time: string;
  /** 0 = Sunday … 6 = Saturday; used by the weekly cadence. */
  weekday: number;
  metrics: AppleHealthMetricId[];
};

export type HealthConfig = {
  /** Keep the daily summaries paired phones upload. Off until the user turns it on. */
  summaryStore: {
    enabled: boolean;
    retentionDays: number;
  };
  digest: HealthDigestConfig;
};

export const DEFAULT_HEALTH_DIGEST_METRICS: readonly AppleHealthMetricId[] = [
  'sleep-duration',
  'sleep-schedule',
  'resting-heart-rate',
  'heart-rate-variability',
  'steps',
  'active-energy',
  'exercise-minutes',
  'workouts',
];

export function createDefaultHealthConfig(): HealthConfig {
  return {
    summaryStore: { enabled: false, retentionDays: HEALTH_SUMMARY_DEFAULT_RETENTION_DAYS },
    digest: {
      enabled: false,
      model: null,
      cadence: 'daily',
      time: '08:00',
      weekday: 1,
      metrics: [...DEFAULT_HEALTH_DIGEST_METRICS],
    },
  };
}

const DIGEST_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Coerce stored config into a usable shape. A digest that cannot run — no
 * model chosen, or nothing stored to read — is normalized to off rather than
 * left "enabled" and silently idle.
 */
export function normalizeHealthConfig(value: unknown): HealthConfig {
  const defaults = createDefaultHealthConfig();
  if (!isPlainRecord(value)) {
    return defaults;
  }
  const store = isPlainRecord(value.summaryStore) ? value.summaryStore : {};
  const digest = isPlainRecord(value.digest) ? value.digest : {};
  const retentionDays =
    typeof store.retentionDays === 'number' && Number.isInteger(store.retentionDays)
      ? Math.min(Math.max(store.retentionDays, 7), HEALTH_SUMMARY_MAX_RETENTION_DAYS)
      : defaults.summaryStore.retentionDays;
  const storeEnabled = store.enabled === true;
  const model = readModelRef(digest.model);
  const metrics = readMetrics(digest.metrics);
  return {
    summaryStore: { enabled: storeEnabled, retentionDays },
    digest: {
      enabled: digest.enabled === true && storeEnabled && model !== null,
      model,
      cadence: digest.cadence === 'weekly' ? 'weekly' : 'daily',
      time:
        typeof digest.time === 'string' && DIGEST_TIME_PATTERN.test(digest.time)
          ? digest.time
          : defaults.digest.time,
      weekday:
        typeof digest.weekday === 'number' &&
        Number.isInteger(digest.weekday) &&
        digest.weekday >= 0 &&
        digest.weekday <= 6
          ? digest.weekday
          : defaults.digest.weekday,
      metrics: metrics.length > 0 ? metrics : defaults.digest.metrics,
    },
  };
}

export function parseHealthSummarySyncBatch(
  value: unknown,
): ClientToolParseResult<HealthSummarySyncBatchV1> {
  if (!isPlainRecord(value)) {
    return fail('health summary batch must be a plain object');
  }
  const allowed = new Set([
    'schemaVersion',
    'batchId',
    'generatedAt',
    'timeZone',
    'startDate',
    'endDateExclusive',
    'metrics',
    'records',
  ]);
  // A body that names its own device is refused: identity comes from the credential.
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    return fail('health summary batch has unknown fields');
  }
  if (value.schemaVersion !== 1) {
    return fail('health summary batch schemaVersion must be 1');
  }
  if (
    typeof value.batchId !== 'string' ||
    value.batchId.length === 0 ||
    value.batchId.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(value.batchId)
  ) {
    return fail('health summary batch id is invalid');
  }
  if (typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))) {
    return fail('health summary batch generatedAt is invalid');
  }
  if (
    typeof value.timeZone !== 'string' ||
    value.timeZone.length === 0 ||
    value.timeZone.length > 64 ||
    !/^[A-Za-z0-9_+\-/]+$/.test(value.timeZone)
  ) {
    return fail('health summary batch timeZone is invalid');
  }
  if (
    typeof value.startDate !== 'string' ||
    typeof value.endDateExclusive !== 'string' ||
    !isAppleHealthLocalDate(value.startDate) ||
    !isAppleHealthLocalDate(value.endDateExclusive) ||
    value.startDate >= value.endDateExclusive
  ) {
    return fail('health summary batch window is invalid');
  }
  const windowDays =
    (Date.parse(`${value.endDateExclusive}T00:00:00Z`) -
      Date.parse(`${value.startDate}T00:00:00Z`)) /
    86_400_000;
  if (windowDays > HEALTH_SUMMARY_MAX_WINDOW_DAYS) {
    return fail('health summary batch window exceeds 90 days');
  }
  const metrics = readMetrics(value.metrics);
  if (
    !Array.isArray(value.metrics) ||
    metrics.length !== value.metrics.length ||
    metrics.length === 0 ||
    metrics.length > APPLE_HEALTH_MAX_METRICS_PER_CALL
  ) {
    return fail('health summary batch metrics must be 1..8 unique allowlisted ids');
  }
  const records = parseAppleHealthRecords(value.records, { requestedMetrics: metrics });
  if (!records.ok) {
    return records;
  }
  for (const record of records.value) {
    if (record.localHour !== undefined) {
      return fail('health summary batch records must be daily');
    }
    if (record.localDate < value.startDate || record.localDate >= value.endDateExclusive) {
      return fail('health summary batch record is outside its window');
    }
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      batchId: value.batchId,
      generatedAt: value.generatedAt,
      timeZone: value.timeZone,
      startDate: value.startDate,
      endDateExclusive: value.endDateExclusive,
      metrics,
      records: records.value,
    },
  };
}

function readMetrics(value: unknown): AppleHealthMetricId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const metrics: AppleHealthMetricId[] = [];
  for (const item of value) {
    if (typeof item === 'string' && isAppleHealthMetricId(item) && !metrics.includes(item)) {
      metrics.push(item);
    }
  }
  return metrics.slice(0, APPLE_HEALTH_METRIC_IDS.length);
}

function readModelRef(value: unknown): ModelRef | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  if (
    typeof value.providerId !== 'string' ||
    value.providerId.length === 0 ||
    typeof value.modelId !== 'string' ||
    value.modelId.length === 0
  ) {
    return null;
  }
  return value as ModelRef;
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
