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
