/**
 * On-device Apple Health aggregation helpers. Native Swift uses the same
 * rules; this module is the shipped TypeScript implementation tests drive.
 */

export type TimeInterval = {
  startMs: number;
  endMs: number;
};

export const SLEEP_EPISODE_GAP_MS = 120 * 60 * 1000;
export const SLEEP_LOOKBACK_MS = 18 * 60 * 60 * 1000;

export function unionIntervals(intervals: readonly TimeInterval[]): TimeInterval[] {
  const valid = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .map((interval) => ({ startMs: interval.startMs, endMs: interval.endMs }))
    .sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  const unioned: TimeInterval[] = [];
  for (const interval of valid) {
    const last = unioned[unioned.length - 1];
    if (last === undefined || interval.startMs > last.endMs) {
      unioned.push({ ...interval });
      continue;
    }
    last.endMs = Math.max(last.endMs, interval.endMs);
  }
  return unioned;
}

export function groupSleepEpisodes(intervals: readonly TimeInterval[]): TimeInterval[] {
  const unioned = unionIntervals(intervals);
  const episodes: TimeInterval[] = [];
  for (const interval of unioned) {
    const last = episodes[episodes.length - 1];
    if (last === undefined || interval.startMs - last.endMs > SLEEP_EPISODE_GAP_MS) {
      episodes.push({ ...interval });
      continue;
    }
    last.endMs = Math.max(last.endMs, interval.endMs);
  }
  return episodes;
}

export function localDateFromInstant(instantMs: number, timeZone: string): string {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instantMs));
  return formatted;
}

export function attributeSleepEpisodeToLocalDate(
  episode: TimeInterval,
  timeZone: string,
): string {
  return localDateFromInstant(episode.endMs, timeZone);
}

export function sleepMinutesByLocalDate(
  intervals: readonly TimeInterval[],
  timeZone: string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const episode of groupSleepEpisodes(intervals)) {
    const localDate = attributeSleepEpisodeToLocalDate(episode, timeZone);
    const minutes = Math.round((episode.endMs - episode.startMs) / 60_000);
    totals.set(localDate, (totals.get(localDate) ?? 0) + minutes);
  }
  return totals;
}

export type SleepSchedule = {
  /** Minutes from noon of the local day before the wake date (23:30 → 690, 01:00 → 780). */
  bedtimeMinutesAfterNoon: number;
  wakeMinuteOfDay: number;
  /** Bedtime to wake, including time awake in between. */
  spanMinutes: number;
};

/**
 * Bedtime and wake time of each night's main (longest) sleep episode, keyed by
 * the local date it ends on. Naps never override the main episode.
 */
export function sleepScheduleByLocalDate(
  intervals: readonly TimeInterval[],
  timeZone: string,
): Map<string, SleepSchedule> {
  const longest = new Map<string, TimeInterval>();
  for (const episode of groupSleepEpisodes(intervals)) {
    const localDate = attributeSleepEpisodeToLocalDate(episode, timeZone);
    const current = longest.get(localDate);
    if (
      current === undefined ||
      episode.endMs - episode.startMs > current.endMs - current.startMs
    ) {
      longest.set(localDate, episode);
    }
  }
  const schedules = new Map<string, SleepSchedule>();
  for (const [localDate, episode] of longest) {
    const bed = localClock(episode.startMs, timeZone);
    const wake = localClock(episode.endMs, timeZone);
    const daysBeforeWake = wake.dayIndex - bed.dayIndex;
    const bedtimeMinutesAfterNoon = bed.minuteOfDay - 720 + (1 - daysBeforeWake) * 1440;
    if (bedtimeMinutesAfterNoon < 0) {
      // An "episode" that began before noon of the previous day is not one night.
      continue;
    }
    schedules.set(localDate, {
      bedtimeMinutesAfterNoon,
      wakeMinuteOfDay: wake.minuteOfDay,
      spanMinutes: Math.round((episode.endMs - episode.startMs) / 60_000),
    });
  }
  return schedules;
}

function localClock(
  instantMs: number,
  timeZone: string,
): { dayIndex: number; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  return {
    dayIndex: Date.UTC(read('year'), read('month') - 1, read('day')) / 86_400_000,
    minuteOfDay: read('hour') * 60 + read('minute'),
  };
}

export function redactHealthRecord(record: Record<string, unknown>): Record<string, unknown> {
  const {
    uuid: _uuid,
    sourceName: _source,
    device: _device,
    metadata: _metadata,
    route: _route,
    ...rest
  } = record;
  return rest;
}
