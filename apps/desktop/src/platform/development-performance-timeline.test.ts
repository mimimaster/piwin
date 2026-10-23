// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installDevelopmentPerformanceTimelineGuard,
  pruneDevelopmentPerformanceTimeline,
  type PerformanceTimelinePort,
} from './development-performance-timeline';

function createTimeline(initialMeasureCount: number): {
  timeline: PerformanceTimelinePort;
  setMeasureCount: (count: number) => void;
  getMeasureCount: () => number;
  measure: ReturnType<typeof vi.fn>;
  clearMeasures: ReturnType<typeof vi.fn>;
  clearMarks: ReturnType<typeof vi.fn>;
} {
  let measureCount = initialMeasureCount;
  const clearMeasures = vi.fn(() => {
    measureCount = 0;
  });
  const clearMarks = vi.fn();
  const measure = vi.fn(() => {
    measureCount += 1;
    return { name: 'measure' };
  });

  return {
    timeline: {
      getEntriesByType: (type) =>
        type === 'measure' ? Array.from({ length: measureCount }, () => ({})) : [],
      clearMeasures,
      clearMarks,
      measure,
    },
    setMeasureCount: (count) => {
      measureCount = count;
    },
    getMeasureCount: () => measureCount,
    measure,
    clearMeasures,
    clearMarks,
  };
}

describe('development performance timeline budget', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves a timing window at or below the configured budget', () => {
    const fixture = createTimeline(5_000);

    expect(pruneDevelopmentPerformanceTimeline(fixture.timeline, 5_000)).toBe(false);
    expect(fixture.clearMeasures).not.toHaveBeenCalled();
    expect(fixture.clearMarks).not.toHaveBeenCalled();
  });

  it('clears measures and their marks after the budget is exceeded', () => {
    const fixture = createTimeline(5_001);

    expect(pruneDevelopmentPerformanceTimeline(fixture.timeline, 5_000)).toBe(true);
    expect(fixture.clearMeasures).toHaveBeenCalledOnce();
    expect(fixture.clearMarks).toHaveBeenCalledOnce();
  });

  it('prunes immediately, repeats on the interval, and stops after disposal', () => {
    vi.useFakeTimers();
    const fixture = createTimeline(101);

    const dispose = installDevelopmentPerformanceTimelineGuard({
      timeline: fixture.timeline,
      maximumMeasures: 100,
      intervalMs: 50,
    });
    expect(fixture.clearMeasures).toHaveBeenCalledTimes(1);

    fixture.setMeasureCount(101);
    vi.advanceTimersByTime(50);
    expect(fixture.clearMeasures).toHaveBeenCalledTimes(2);

    dispose();
    fixture.setMeasureCount(101);
    vi.advanceTimersByTime(100);
    expect(fixture.clearMeasures).toHaveBeenCalledTimes(2);
  });

  it('enforces the bound synchronously when one event-loop turn floods measures', () => {
    vi.useFakeTimers();
    const fixture = createTimeline(0);
    const originalMeasure = fixture.timeline.measure;
    const dispose = installDevelopmentPerformanceTimelineGuard({
      timeline: fixture.timeline,
      maximumMeasures: 3,
      intervalMs: 10_000,
    });

    fixture.timeline.measure('one');
    fixture.timeline.measure('two');
    fixture.timeline.measure('three');
    expect(fixture.getMeasureCount()).toBe(3);
    expect(fixture.clearMeasures).not.toHaveBeenCalled();

    // No timer advances: the fourth write itself enforces the budget.
    fixture.timeline.measure('four');
    expect(fixture.clearMeasures).toHaveBeenCalledTimes(1);
    expect(fixture.clearMarks).toHaveBeenCalledTimes(1);
    expect(fixture.getMeasureCount()).toBe(0);

    dispose();
    expect(fixture.timeline.measure).toBe(originalMeasure);
  });

  it('rejects invalid budgets rather than silently disabling the bound', () => {
    const fixture = createTimeline(1);

    expect(() => pruneDevelopmentPerformanceTimeline(fixture.timeline, 0)).toThrow(RangeError);
  });
});
