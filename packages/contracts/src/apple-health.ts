/**
 * Apple Health v1 data contract: metric allowlist, query arguments, and the
 * normalized on-device summary that may leave the phone.
 */

import type { ClientToolParseResult } from './client-tool.js';

export const APPLE_HEALTH_METRIC_IDS = [
  'steps',
  'active-energy',
  'exercise-minutes',
  'workouts',
  'sleep-duration',
  'sleep-stages',
  'resting-heart-rate',
  'heart-rate-variability',
] as const;

export type AppleHealthMetricId = (typeof APPLE_HEALTH_METRIC_IDS)[number];

export const APPLE_HEALTH_MAX_TOTAL_WINDOW_DAYS = 90;
export const APPLE_HEALTH_MAX_RECORDS = 720;
export const APPLE_HEALTH_MAX_UNAVAILABLE_METRICS = 8;
export const APPLE_HEALTH_MAX_WARNINGS = 16;
export const APPLE_HEALTH_SCHEMA_VERSION = 1 as const;
export const CONNECTED_SOURCE_APPLE_HEALTH_LABEL = 'Apple Health' as const;
export const APPLE_HEALTH_CONNECTED_SOURCE = 'apple-health' as const;
export const HEALTH_MODEL_OUTPUT_PREAMBLE =
  'These values are user-authorized Apple Health summaries. Missing metrics are unknown, not zero.';

export type AppleHealthUnit = 'count' | 'kcal' | 'minute' | 'bpm' | 'ms';

export type HealthReadRange =
  | { preset: 'today' | 'last-7-days' | 'last-30-days' }
  | { preset: 'custom'; startDate: string; endDateExclusive: string };

export type HealthReadGranularity = 'summary' | 'day';

export type HealthReadContextArguments = {
  metrics: AppleHealthMetricId[];
  range: HealthReadRange;
  granularity?: HealthReadGranularity;
  includePreviousPeriod?: boolean;
};

export type AppleHealthUnavailableReason =
  | 'not-authorized-or-no-data'
  | 'unsupported'
  | 'query-failed';

export type AppleHealthWarning =
  | 'partial-result'
  | 'sleep-source-overlap-normalized'
  | 'timezone-changed-within-range'
  | 'comparison-unavailable';

export type AppleHealthRecord = {
  metric: AppleHealthMetricId;
  localDate: string;
  unit: AppleHealthUnit;
  value?: number;
  components?: Record<string, number>;
  sampleCount?: number;
  freshAsOf: string;
};

export type AppleHealthReadResultV1 = {
  schemaVersion: 1;
  source: 'apple-health';
  timeZone: string;
  startAt: string;
  endAt: string;
  generatedAt: string;
  records: AppleHealthRecord[];
  unavailableMetrics: Array<{
    metric: AppleHealthMetricId;
    reason: AppleHealthUnavailableReason;
  }>;
  warnings: AppleHealthWarning[];
};

export type ConnectedSourceContextRef = {
  kind: 'connected-source';
  source: 'apple-health';
  label: 'Apple Health';
};

export const HEALTH_TOOL_CARD_STATUSES = [
  'waiting-for-phone',
  'awaiting-consent',
  'awaiting-healthkit-authorization',
  'reading',
  'completed',
  'partial',
  'denied',
  'no-data',
  'phone-offline',
  'timed-out',
  'cancelled',
  'failed',
] as const;

export type HealthToolCardStatus = (typeof HEALTH_TOOL_CARD_STATUSES)[number];

export type HealthToolCardSummary = {
  metrics: AppleHealthMetricId[];
  periodLabel: string;
  status: HealthToolCardStatus;
  freshnessLabel?: string;
  timezone?: string;
  unavailableMetrics?: AppleHealthMetricId[];
  warnings?: AppleHealthWarning[];
};

const HEALTH_TOOL_CARD_STATUS_SET: ReadonlySet<string> = new Set(HEALTH_TOOL_CARD_STATUSES);

/**
 * Bounded Health card for remote/UI projection. Copies only allowlisted
 * summary fields — never series, HealthKit UUIDs, raw output, or error strings.
 */
export function projectBoundedHealthToolCardSummary(
  value: unknown,
): HealthToolCardSummary | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  if (typeof value.periodLabel !== 'string' || value.periodLabel.trim().length === 0) {
    return undefined;
  }
  if (typeof value.status !== 'string' || !HEALTH_TOOL_CARD_STATUS_SET.has(value.status)) {
    return undefined;
  }
  if (!Array.isArray(value.metrics)) {
    return undefined;
  }
  const metrics: AppleHealthMetricId[] = [];
  const seenMetrics = new Set<string>();
  for (const item of value.metrics) {
    if (typeof item !== 'string' || !isAppleHealthMetricId(item) || seenMetrics.has(item)) {
      continue;
    }
    seenMetrics.add(item);
    metrics.push(item);
    if (metrics.length >= APPLE_HEALTH_METRIC_IDS.length) {
      break;
    }
  }
  if (metrics.length === 0) {
    return undefined;
  }
  const summary: HealthToolCardSummary = {
    metrics,
    periodLabel: boundHealthLabel(value.periodLabel, 128),
    status: value.status as HealthToolCardStatus,
  };
  if (typeof value.freshnessLabel === 'string' && value.freshnessLabel.trim().length > 0) {
    summary.freshnessLabel = boundHealthLabel(value.freshnessLabel, 64);
  }
  if (typeof value.timezone === 'string' && IANA_TIMEZONE_PATTERN.test(value.timezone)) {
    summary.timezone = value.timezone;
  }
  const unavailable = projectBoundedMetricIds(value.unavailableMetrics);
  if (unavailable !== undefined) {
    summary.unavailableMetrics = unavailable;
  }
  const warnings = projectBoundedHealthWarnings(value.warnings);
  if (warnings !== undefined) {
    summary.warnings = warnings;
  }
  return summary;
}

function projectBoundedMetricIds(value: unknown): AppleHealthMetricId[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const metrics: AppleHealthMetricId[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !isAppleHealthMetricId(item) || seen.has(item)) {
      continue;
    }
    seen.add(item);
    metrics.push(item);
    if (metrics.length >= APPLE_HEALTH_METRIC_IDS.length) {
      break;
    }
  }
  return metrics.length > 0 ? metrics : undefined;
}

function projectBoundedHealthWarnings(value: unknown): AppleHealthWarning[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const warnings: AppleHealthWarning[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !WARNINGS.has(item as AppleHealthWarning) || seen.has(item)) {
      continue;
    }
    seen.add(item);
    warnings.push(item as AppleHealthWarning);
    if (warnings.length >= APPLE_HEALTH_MAX_WARNINGS) {
      break;
    }
  }
  return warnings.length > 0 ? warnings : undefined;
}

function boundHealthLabel(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}…`;
}

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
};

const WORKOUT_COMPONENT_KEYS = new Set([
  'walking',
  'running',
  'cycling',
  'strength-training',
  'swimming',
  'other',
]);

const SLEEP_STAGE_COMPONENT_KEYS = new Set([
  'awake',
  'core',
  'deep',
  'rem',
  'asleep-unspecified',
]);

const UNAVAILABLE_REASONS = new Set<AppleHealthUnavailableReason>([
  'not-authorized-or-no-data',
  'unsupported',
  'query-failed',
]);

const WARNINGS = new Set<AppleHealthWarning>([
  'partial-result',
  'sleep-source-overlap-normalized',
  'timezone-changed-within-range',
  'comparison-unavailable',
]);

const RECORD_KEYS = new Set([
  'metric',
  'localDate',
  'unit',
  'value',
  'components',
  'sampleCount',
  'freshAsOf',
]);

const RESULT_KEYS = new Set([
  'schemaVersion',
  'source',
  'timeZone',
  'startAt',
  'endAt',
  'generatedAt',
  'records',
  'unavailableMetrics',
  'warnings',
]);

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const IANA_TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]+$/;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export function isAppleHealthMetricId(value: string): value is AppleHealthMetricId {
  return METRIC_SET.has(value);
}

export function appleHealthMetricUnit(metric: AppleHealthMetricId): AppleHealthUnit {
  return METRIC_UNITS[metric];
}

export function isAppleHealthConnectedSourceRef(
  value: unknown,
): value is ConnectedSourceContextRef {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.kind === 'connected-source' &&
    record.source === APPLE_HEALTH_CONNECTED_SOURCE &&
    record.label === CONNECTED_SOURCE_APPLE_HEALTH_LABEL
  );
}

export function parseHealthReadContextArguments(
  value: unknown,
): ClientToolParseResult<HealthReadContextArguments> {
  if (!isPlainRecord(value)) {
    return fail('health arguments must be a plain object');
  }
  if (hasUnknownKeys(value, ['metrics', 'range', 'granularity', 'includePreviousPeriod'])) {
    return fail('health arguments have unknown fields');
  }
  if (!Array.isArray(value.metrics) || value.metrics.length < 1 || value.metrics.length > 8) {
    return fail('health metrics must contain 1..8 values');
  }
  const metrics: AppleHealthMetricId[] = [];
  const seen = new Set<string>();
  for (const metric of value.metrics) {
    if (typeof metric !== 'string' || !isAppleHealthMetricId(metric) || seen.has(metric)) {
      return fail('health metrics must be unique allowlisted ids');
    }
    seen.add(metric);
    metrics.push(metric);
  }
  const range = parseRange(value.range);
  if (!range.ok) {
    return range;
  }
  const windowDays = healthWindowDays(range.value, value.includePreviousPeriod === true);
  if (windowDays < 1 || windowDays > APPLE_HEALTH_MAX_TOTAL_WINDOW_DAYS) {
    return fail('health query window exceeds 90 days');
  }
  const parsed: HealthReadContextArguments = {
    metrics,
    range: range.value,
  };
  if (value.granularity !== undefined) {
    if (value.granularity !== 'summary' && value.granularity !== 'day') {
      return fail('health granularity is invalid');
    }
    parsed.granularity = value.granularity;
  }
  if (value.includePreviousPeriod !== undefined) {
    if (typeof value.includePreviousPeriod !== 'boolean') {
      return fail('includePreviousPeriod must be boolean');
    }
    parsed.includePreviousPeriod = value.includePreviousPeriod;
  }
  return { ok: true, value: parsed };
}

export function healthWindowDays(
  range: HealthReadRange,
  includePreviousPeriod: boolean,
): number {
  const days = rangeDayCount(range);
  return includePreviousPeriod ? days * 2 : days;
}

export type AppleHealthResultParseOptions = {
  requestedMetrics?: readonly AppleHealthMetricId[];
  localDates?: readonly string[];
};

export function parseAppleHealthReadResultV1(
  value: unknown,
  options: AppleHealthResultParseOptions = {},
): ClientToolParseResult<AppleHealthReadResultV1> {
  if (!isPlainRecord(value)) {
    return fail('health result must be a plain object');
  }
  if (hasUnknownKeys(value, [...RESULT_KEYS])) {
    return fail('health result has unknown fields');
  }
  if (value.schemaVersion !== APPLE_HEALTH_SCHEMA_VERSION) {
    return fail('health result schemaVersion must be 1');
  }
  if (value.source !== 'apple-health') {
    return fail('health result source must be apple-health');
  }
  if (
    typeof value.timeZone !== 'string' ||
    value.timeZone.length === 0 ||
    value.timeZone.length > 64 ||
    !IANA_TIMEZONE_PATTERN.test(value.timeZone)
  ) {
    return fail('health result timeZone is invalid');
  }
  if (!isRfc3339(value.startAt) || !isRfc3339(value.endAt) || !isRfc3339(value.generatedAt)) {
    return fail('health result timestamps must be RFC 3339');
  }
  if (!Array.isArray(value.records) || value.records.length > APPLE_HEALTH_MAX_RECORDS) {
    return fail('health result records exceed bounds');
  }
  const requested = options.requestedMetrics ? new Set(options.requestedMetrics) : undefined;
  const allowedDates = options.localDates ? new Set(options.localDates) : undefined;
  const seenPairs = new Set<string>();
  const records: AppleHealthRecord[] = [];
  for (const item of value.records) {
    const record = parseRecord(item, requested, allowedDates);
    if (!record.ok) {
      return record;
    }
    const key = `${record.value.metric}:${record.value.localDate}`;
    if (seenPairs.has(key)) {
      return fail('health result records must be unique per metric and local date');
    }
    seenPairs.add(key);
    records.push(record.value);
  }
  const unavailable = parseUnavailable(value.unavailableMetrics, requested);
  if (!unavailable.ok) {
    return unavailable;
  }
  const warnings = parseWarnings(value.warnings);
  if (!warnings.ok) {
    return warnings;
  }
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      source: 'apple-health',
      timeZone: value.timeZone,
      startAt: value.startAt,
      endAt: value.endAt,
      generatedAt: value.generatedAt,
      records,
      unavailableMetrics: unavailable.value,
      warnings: warnings.value,
    },
  };
}

function parseRecord(
  value: unknown,
  requested: ReadonlySet<string> | undefined,
  allowedDates: ReadonlySet<string> | undefined,
): ClientToolParseResult<AppleHealthRecord> {
  if (!isPlainRecord(value)) {
    return fail('health record must be a plain object');
  }
  if (Object.keys(value).some((key) => !RECORD_KEYS.has(key))) {
    return fail('health record has unknown fields');
  }
  if (typeof value.metric !== 'string' || !isAppleHealthMetricId(value.metric)) {
    return fail('health record metric is invalid');
  }
  if (requested && !requested.has(value.metric)) {
    return fail('health record metric was not requested');
  }
  if (typeof value.localDate !== 'string' || !isLocalDate(value.localDate)) {
    return fail('health record localDate is invalid');
  }
  if (allowedDates && !allowedDates.has(value.localDate)) {
    return fail('health record localDate is outside the requested range');
  }
  const expectedUnit = METRIC_UNITS[value.metric];
  if (value.unit !== expectedUnit) {
    return fail('health record unit does not match metric');
  }
  if (!isRfc3339(value.freshAsOf)) {
    return fail('health record freshAsOf must be RFC 3339');
  }
  const record: AppleHealthRecord = {
    metric: value.metric,
    localDate: value.localDate,
    unit: expectedUnit,
    freshAsOf: value.freshAsOf,
  };
  if (value.value !== undefined) {
    if (typeof value.value !== 'number' || !Number.isFinite(value.value) || value.value < 0) {
      return fail('health record value must be a finite non-negative number');
    }
    record.value = value.value;
  }
  if (value.sampleCount !== undefined) {
    if (
      typeof value.sampleCount !== 'number' ||
      !Number.isSafeInteger(value.sampleCount) ||
      value.sampleCount < 0
    ) {
      return fail('health record sampleCount is invalid');
    }
    record.sampleCount = value.sampleCount;
  }
  if (value.components !== undefined) {
    const components = parseComponents(value.metric, value.components);
    if (!components.ok) {
      return components;
    }
    record.components = components.value;
  }
  return { ok: true, value: record };
}

function parseComponents(
  metric: AppleHealthMetricId,
  value: unknown,
): ClientToolParseResult<Record<string, number>> {
  if (!isPlainRecord(value)) {
    return fail('health record components must be a plain object');
  }
  const allowlist =
    metric === 'workouts'
      ? WORKOUT_COMPONENT_KEYS
      : metric === 'sleep-stages'
        ? SLEEP_STAGE_COMPONENT_KEYS
        : undefined;
  if (allowlist === undefined) {
    return fail('health record components are not allowed for this metric');
  }
  const components: Record<string, number> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (!allowlist.has(key)) {
      return fail('health record component key is not allowlisted');
    }
    if (typeof nested !== 'number' || !Number.isFinite(nested) || nested < 0) {
      return fail('health record component values must be finite and non-negative');
    }
    components[key] = nested;
  }
  return { ok: true, value: components };
}

function parseUnavailable(
  value: unknown,
  requested: ReadonlySet<string> | undefined,
): ClientToolParseResult<AppleHealthReadResultV1['unavailableMetrics']> {
  if (!Array.isArray(value)) {
    return fail('unavailableMetrics must be an array');
  }
  if (value.length > APPLE_HEALTH_MAX_UNAVAILABLE_METRICS) {
    return fail('unavailableMetrics exceed bounds');
  }
  const seen = new Set<string>();
  const items: AppleHealthReadResultV1['unavailableMetrics'] = [];
  for (const item of value) {
    if (!isPlainRecord(item)) {
      return fail('unavailable metric must be a plain object');
    }
    if (hasUnknownKeys(item, ['metric', 'reason'])) {
      return fail('unavailable metric has unknown fields');
    }
    if (typeof item.metric !== 'string' || !isAppleHealthMetricId(item.metric)) {
      return fail('unavailable metric id is invalid');
    }
    if (requested && !requested.has(item.metric)) {
      return fail('unavailable metric was not requested');
    }
    if (typeof item.reason !== 'string' || !UNAVAILABLE_REASONS.has(item.reason as AppleHealthUnavailableReason)) {
      return fail('unavailable metric reason is invalid');
    }
    if (seen.has(item.metric)) {
      return fail('unavailable metrics must be unique');
    }
    seen.add(item.metric);
    items.push({ metric: item.metric, reason: item.reason as AppleHealthUnavailableReason });
  }
  return { ok: true, value: items };
}

function parseWarnings(value: unknown): ClientToolParseResult<AppleHealthWarning[]> {
  if (!Array.isArray(value)) {
    return fail('warnings must be an array');
  }
  if (value.length > APPLE_HEALTH_MAX_WARNINGS) {
    return fail('warnings exceed bounds');
  }
  const warnings: AppleHealthWarning[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !WARNINGS.has(item as AppleHealthWarning)) {
      return fail('health warning is invalid');
    }
    if (seen.has(item)) {
      continue;
    }
    seen.add(item);
    warnings.push(item as AppleHealthWarning);
  }
  return { ok: true, value: warnings };
}

function parseRange(value: unknown): ClientToolParseResult<HealthReadRange> {
  if (!isPlainRecord(value) || typeof value.preset !== 'string') {
    return fail('health range is invalid');
  }
  if (value.preset === 'today' || value.preset === 'last-7-days' || value.preset === 'last-30-days') {
    if (hasUnknownKeys(value, ['preset'])) {
      return fail('health range has unknown fields');
    }
    return { ok: true, value: { preset: value.preset } };
  }
  if (value.preset !== 'custom') {
    return fail('health range preset is invalid');
  }
  if (typeof value.startDate !== 'string' || !isLocalDate(value.startDate)) {
    return fail('health custom startDate is invalid');
  }
  if (typeof value.endDateExclusive !== 'string' || !isLocalDate(value.endDateExclusive)) {
    return fail('health custom endDateExclusive is invalid');
  }
  if (compareLocalDate(value.startDate, value.endDateExclusive) >= 0) {
    return fail('health custom range is reversed or empty');
  }
  const today = utcLocalDate(new Date());
  if (compareLocalDate(value.startDate, today) > 0) {
    return fail('health custom startDate is in the future');
  }
  const tomorrow = addLocalDateDays(today, 1);
  if (compareLocalDate(value.endDateExclusive, tomorrow) > 0) {
    return fail('health custom endDateExclusive is in the future');
  }
  if (hasUnknownKeys(value, ['preset', 'startDate', 'endDateExclusive'])) {
    return fail('health range has unknown fields');
  }
  return {
    ok: true,
    value: {
      preset: 'custom',
      startDate: value.startDate,
      endDateExclusive: value.endDateExclusive,
    },
  };
}

function rangeDayCount(range: HealthReadRange): number {
  switch (range.preset) {
    case 'today':
      return 1;
    case 'last-7-days':
      return 7;
    case 'last-30-days':
      return 30;
    case 'custom':
      return localDateIndex(range.endDateExclusive) - localDateIndex(range.startDate);
  }
}

function isLocalDate(value: string): boolean {
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

function localDateIndex(value: string): number {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    return Number.NaN;
  }
  const date = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date / 86_400_000;
}

function compareLocalDate(left: string, right: string): number {
  return localDateIndex(left) - localDateIndex(right);
}

function utcLocalDate(now: Date): string {
  return fromUtcDayIndex(Math.floor(now.getTime() / 86_400_000));
}

function addLocalDateDays(localDate: string, days: number): string {
  return fromUtcDayIndex(localDateIndex(localDate) + days);
}

function fromUtcDayIndex(index: number): string {
  const date = new Date(index * 86_400_000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function enumerateLocalDates(startInclusive: string, endExclusive: string): string[] {
  const dates: string[] = [];
  let index = localDateIndex(startInclusive);
  const end = localDateIndex(endExclusive);
  while (index < end) {
    dates.push(fromUtcDayIndex(index));
    index += 1;
  }
  return dates;
}

export function formatLocalDateInTimeZone(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (year === undefined || month === undefined || day === undefined) {
    return utcLocalDate(instant);
  }
  return `${year}-${month}-${day}`;
}

export function healthRequestedLocalDates(
  range: HealthReadRange,
  includePreviousPeriod: boolean,
  timeZone: string,
  now: Date = new Date(),
): string[] {
  let startInclusive: string;
  let endExclusive: string;
  if (range.preset === 'custom') {
    startInclusive = range.startDate;
    endExclusive = range.endDateExclusive;
  } else {
    const today = formatLocalDateInTimeZone(now, timeZone);
    endExclusive = addLocalDateDays(today, 1);
    const days = range.preset === 'today' ? 1 : range.preset === 'last-7-days' ? 7 : 30;
    startInclusive = addLocalDateDays(endExclusive, -days);
  }
  if (includePreviousPeriod) {
    const length = localDateIndex(endExclusive) - localDateIndex(startInclusive);
    startInclusive = addLocalDateDays(startInclusive, -length);
  }
  return enumerateLocalDates(startInclusive, endExclusive);
}

export function healthResultWindowMatchesRequest(
  result: { timeZone: string; startAt: string; endAt: string },
  requestedDates: readonly string[],
): boolean {
  if (requestedDates.length === 0) {
    return false;
  }
  const first = requestedDates[0];
  const last = requestedDates[requestedDates.length - 1];
  if (first === undefined || last === undefined) {
    return false;
  }
  const startLocal = formatLocalDateInTimeZone(new Date(result.startAt), result.timeZone);
  const endMinus = formatLocalDateInTimeZone(new Date(Date.parse(result.endAt) - 1), result.timeZone);
  return startLocal === first && endMinus === last;
}

export function resolveHealthToolCardStatus(
  presentation: { kind?: string; health?: { status?: string } } | undefined,
  toolStatus?: 'running' | 'done' | 'error',
): HealthToolCardStatus {
  const status = presentation?.health?.status;
  if (typeof status === 'string' && HEALTH_TOOL_CARD_STATUS_SET.has(status)) {
    return status as HealthToolCardStatus;
  }
  if (toolStatus === 'error') {
    return 'failed';
  }
  return 'waiting-for-phone';
}

function isRfc3339(value: unknown): value is string {
  return typeof value === 'string' && RFC3339_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasUnknownKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).some((key) => !allowedSet.has(key));
}

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}
