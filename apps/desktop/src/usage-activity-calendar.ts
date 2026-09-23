/**
 * Pure data shaping for the usage heatmap: a weeks × weekdays calendar of the
 * last year, four intensity levels, month labels, and the headline numbers.
 *
 * Day keys come from the Host bucketed in the viewer's time zone
 * (`usage/get-rollup` `timeZone`); "today" and the calendar use the same zone
 * so a cell and its date always describe the same local day.
 */
import type { UsageBucket } from '@piwin/contracts';

export type UsageActivityMetric = 'tokens' | 'requests';

/** 0 = no usage; 1–4 = quartiles of the active days' values. */
export type UsageActivityLevel = 0 | 1 | 2 | 3 | 4;

export type UsageActivityCell = {
  day: string;
  value: number;
  level: UsageActivityLevel;
  bucket: UsageBucket | undefined;
};

export type UsageActivityCalendar = {
  /** Columns are weeks (Monday first); `null` marks days after today. */
  weeks: Array<Array<UsageActivityCell | null>>;
  /** Column index → month label key (`YYYY-MM`) where a month starts. */
  monthStarts: Array<{ column: number; month: string }>;
  activeDays: number;
  activeAverage: number | null;
  peak: UsageActivityCell | null;
  today: UsageActivityCell | null;
  /** Consecutive active days ending today (or yesterday, if today is still empty). */
  streak: number;
};

export const USAGE_ACTIVITY_WEEKS = 53;
const DAY_MS = 24 * 60 * 60 * 1000;

export function metricValue(bucket: UsageBucket | undefined, metric: UsageActivityMetric): number {
  if (bucket === undefined) return 0;
  return metric === 'tokens' ? bucket.totalTokens : bucket.entryCount;
}

/** `YYYY-MM-DD` of an instant in `timeZone` (UTC when omitted). */
export function dayKeyIn(date: Date, timeZone?: string): string {
  if (timeZone === undefined) return date.toISOString().slice(0, 10);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Calendar arithmetic on a day key; the key is a date, not an instant. */
export function addDays(dayKey: string, offset: number): string {
  return new Date(Date.parse(`${dayKey}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday. */
function weekdayOf(dayKey: string): number {
  return (new Date(`${dayKey}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/** First day of the heatmap: the Monday `weeks - 1` weeks before this week. */
export function heatmapStart(todayKey: string, weeks = USAGE_ACTIVITY_WEEKS): string {
  return addDays(todayKey, -weekdayOf(todayKey) - (weeks - 1) * 7);
}

/** Quartile thresholds over the active days, so one huge day does not wash out the rest. */
export function levelThresholds(values: readonly number[]): [number, number, number] {
  const active = values.filter((value) => value > 0).sort((left, right) => left - right);
  if (active.length === 0) return [0, 0, 0];
  const at = (fraction: number): number =>
    active[Math.min(active.length - 1, Math.floor(fraction * active.length))] ?? 0;
  return [at(0.25), at(0.5), at(0.75)];
}

export function levelOf(value: number, thresholds: readonly [number, number, number]): UsageActivityLevel {
  if (value <= 0) return 0;
  if (value <= thresholds[0]) return 1;
  if (value <= thresholds[1]) return 2;
  if (value <= thresholds[2]) return 3;
  return 4;
}

export function buildUsageActivityCalendar(
  byDay: Record<string, UsageBucket>,
  metric: UsageActivityMetric,
  options: { now?: Date; timeZone?: string; weeks?: number } = {},
): UsageActivityCalendar {
  const weekCount = options.weeks ?? USAGE_ACTIVITY_WEEKS;
  const todayKey = dayKeyIn(options.now ?? new Date(), options.timeZone);
  const start = heatmapStart(todayKey, weekCount);

  const days: string[] = [];
  for (let day = start; day <= todayKey; day = addDays(day, 1)) days.push(day);
  const values = days.map((day) => metricValue(byDay[day], metric));
  const thresholds = levelThresholds(values);
  const cells = days.map<UsageActivityCell>((day, index) => {
    const value = values[index] ?? 0;
    return { day, value, level: levelOf(value, thresholds), bucket: byDay[day] };
  });

  const weeks: Array<Array<UsageActivityCell | null>> = [];
  for (let column = 0; column < weekCount; column += 1) {
    weeks.push(
      Array.from({ length: 7 }, (_, row) => cells[column * 7 + row] ?? null),
    );
  }

  const monthStarts: Array<{ column: number; month: string }> = [];
  weeks.forEach((week, column) => {
    const monthStart = week.find((cell) => cell?.day.endsWith('-01'));
    if (monthStart) monthStarts.push({ column, month: monthStart.day.slice(0, 7) });
  });

  const active = cells.filter((cell) => cell.value > 0);
  const peak = active.reduce<UsageActivityCell | null>(
    (best, cell) => (best === null || cell.value > best.value ? cell : best),
    null,
  );
  const today = cells.at(-1) ?? null;

  let streak = 0;
  let cursor = cells.length - 1;
  if (today !== null && today.value === 0) cursor -= 1;
  while (cursor >= 0 && (cells[cursor]?.value ?? 0) > 0) {
    streak += 1;
    cursor -= 1;
  }

  return {
    weeks,
    monthStarts,
    activeDays: active.length,
    activeAverage:
      active.length === 0 ? null : active.reduce((sum, cell) => sum + cell.value, 0) / active.length,
    peak,
    today,
    streak,
  };
}
