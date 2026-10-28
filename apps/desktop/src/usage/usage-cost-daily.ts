/**
 * Pure daily-cost series for the 费用构成 trend.
 *
 * `byDay` only holds days that had calls, keyed `YYYY-MM-DD` in the viewer's
 * zone. The chart needs every day of the selected window, so quiet days
 * become real zero bars. Long ranges ("全部时间") fold into weekly bars to keep
 * each bar wide enough to hover.
 */
import type { UsageBucket } from '@piwin/contracts';

const DAY_MS = 86_400_000;
/** Beyond about a quarter, daily bars get too thin to read or hover. */
const MAX_DAILY_BARS = 93;

export type UsageCostBar = {
  /** First and last day key covered by the bar (equal for daily bars). */
  start: string;
  end: string;
  /** Undefined when the bar had calls but none could be priced. */
  costUsd: number | undefined;
  calls: number;
};

export type UsageCostSeries = {
  bars: UsageCostBar[];
  bucketDays: 1 | 7;
  /** Days covered by the series, used for the daily average. */
  dayCount: number;
  /** Rounded-up axis ceiling; 0 when nothing was priced. */
  axisMaxUsd: number;
  peak: UsageCostBar | undefined;
};

/** `YYYY-MM-DD` for an instant in a time zone (matches the Host's byDay keys). */
export function formatUsageDayKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const part = (type: string): string => parts.find((entry) => entry.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function buildUsageCostSeries(
  byDay: Readonly<Record<string, UsageBucket>>,
  range: { startDay?: string; endDay?: string } = {},
): UsageCostSeries {
  const keys = Object.keys(byDay).filter(isDayKey).sort();
  const startDay = range.startDay ?? keys[0];
  const endDay = range.endDay ?? keys[keys.length - 1];
  if (!startDay || !endDay || !isDayKey(startDay) || !isDayKey(endDay) || startDay > endDay) {
    return { bars: [], bucketDays: 1, dayCount: 0, axisMaxUsd: 0, peak: undefined };
  }
  const first = dayIndex(startDay);
  const dayCount = dayIndex(endDay) - first + 1;
  const bucketDays = dayCount > MAX_DAILY_BARS ? 7 : 1;
  const bars: UsageCostBar[] = [];
  for (let offset = 0; offset < dayCount; offset += bucketDays) {
    const last = Math.min(offset + bucketDays, dayCount) - 1;
    let calls = 0;
    let costUsd: number | undefined;
    for (let day = offset; day <= last; day += 1) {
      const bucket = byDay[dayKey(first + day)];
      if (!bucket) continue;
      calls += bucket.entryCount;
      if (bucket.estimatedCostUsd !== undefined && (bucket.pricedEntryCount ?? 1) > 0) {
        costUsd = (costUsd ?? 0) + bucket.estimatedCostUsd;
      }
    }
    // A bar with no calls is a true zero; one with calls but no price is unknown.
    bars.push({ start: dayKey(first + offset), end: dayKey(first + last), costUsd: calls === 0 ? 0 : costUsd, calls });
  }
  const peak = bars.reduce<UsageCostBar | undefined>(
    (best, bar) => ((bar.costUsd ?? 0) > (best?.costUsd ?? 0) ? bar : best),
    undefined,
  );
  return { bars, bucketDays, dayCount, axisMaxUsd: niceCeiling(peak?.costUsd ?? 0), peak };
}

/** Round an axis maximum up to 1 / 2 / 2.5 / 5 × 10ⁿ so gridline labels stay short. */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= value) return candidate;
  }
  return 10 * magnitude;
}

function isDayKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayIndex(key: string): number {
  return Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
}

function dayKey(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}
