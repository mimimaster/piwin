export const MAX_DEVELOPMENT_PERFORMANCE_MEASURES = 5_000;
export const DEVELOPMENT_PERFORMANCE_PRUNE_INTERVAL_MS = 10_000;

export type PerformanceTimelinePort = {
  getEntriesByType: (type: string) => readonly unknown[];
  clearMeasures: () => void;
  clearMarks: () => void;
  measure: (
    measureName: string,
    startOrMeasureOptions?: string | PerformanceMeasureOptions,
    endMark?: string,
  ) => unknown;
};

export type DevelopmentPerformanceTimelineGuardOptions = {
  timeline?: PerformanceTimelinePort;
  maximumMeasures?: number;
  intervalMs?: number;
};

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${field} must be a positive integer`);
  }
  return value;
}

/**
 * Bound React development User Timing history retained by WebKit.
 *
 * React development builds attach diagnostic detail to PerformanceMeasure
 * entries. WebKit retains those entries until cleared, so an unbounded timing
 * history can retain component diagnostics long after the corresponding work.
 */
export function pruneDevelopmentPerformanceTimeline(
  timeline: PerformanceTimelinePort,
  maximumMeasures = MAX_DEVELOPMENT_PERFORMANCE_MEASURES,
): boolean {
  const maximum = requirePositiveInteger(maximumMeasures, 'maximumMeasures');
  if (timeline.getEntriesByType('measure').length <= maximum) {
    return false;
  }

  timeline.clearMeasures();
  timeline.clearMarks();
  return true;
}

/** Install the development-only budget and return an HMR-safe disposer. */
export function installDevelopmentPerformanceTimelineGuard(
  options: DevelopmentPerformanceTimelineGuardOptions = {},
): () => void {
  const timeline = options.timeline ?? window.performance;
  const maximumMeasures = requirePositiveInteger(
    options.maximumMeasures ?? MAX_DEVELOPMENT_PERFORMANCE_MEASURES,
    'maximumMeasures',
  );
  const intervalMs = requirePositiveInteger(
    options.intervalMs ?? DEVELOPMENT_PERFORMANCE_PRUNE_INTERVAL_MS,
    'intervalMs',
  );
  const originalMeasure = timeline.measure;
  let retainedMeasureCount = timeline.getEntriesByType('measure').length;

  const guardedMeasure: PerformanceTimelinePort['measure'] = (
    measureName,
    startOrMeasureOptions,
    endMark,
  ) => {
    let result: unknown;
    if (startOrMeasureOptions === undefined) {
      result = originalMeasure.call(timeline, measureName);
    } else if (endMark === undefined) {
      result = originalMeasure.call(timeline, measureName, startOrMeasureOptions);
    } else {
      result = originalMeasure.call(timeline, measureName, startOrMeasureOptions, endMark);
    }

    retainedMeasureCount += 1;
    if (retainedMeasureCount > maximumMeasures) {
      // React development instrumentation can produce thousands of entries
      // within one event-loop turn. Clear synchronously at the write boundary
      // so a starved interval cannot overshoot into a multi-gigabyte WebKit
      // timeline allocation. Clear marks only after the measure consumed any
      // named start/end marks supplied by its caller.
      timeline.clearMeasures();
      timeline.clearMarks();
      retainedMeasureCount = 0;
    }
    return result;
  };

  timeline.measure = guardedMeasure;
  const prune = (): void => {
    const pruned = pruneDevelopmentPerformanceTimeline(timeline, maximumMeasures);
    retainedMeasureCount = pruned ? 0 : timeline.getEntriesByType('measure').length;
  };

  // Prune immediately so an HMR update also releases the already-retained
  // development history instead of waiting for the first interval.
  prune();
  const intervalId = window.setInterval(prune, intervalMs);

  return () => {
    window.clearInterval(intervalId);
    if (timeline.measure === guardedMeasure) {
      timeline.measure = originalMeasure;
    }
  };
}
