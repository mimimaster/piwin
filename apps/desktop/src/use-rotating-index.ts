import { useEffect, useState } from 'react';

/** Matches `--behavior-status-duration` (behavior-activity.css). */
export const ROTATING_INDEX_INTERVAL_MS = 1_800;

/**
 * Index that steps through `length` items on a timer, for a header that has
 * to show several concurrent actions one at a time. Stays at 0 while there is
 * nothing to rotate through, so a single action never re-renders on a timer.
 */
export function useRotatingIndex(
  length: number,
  intervalMs: number = ROTATING_INDEX_INTERVAL_MS,
): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (length < 2) return;
    const timer = window.setInterval(() => setTick((current) => current + 1), intervalMs);
    return () => window.clearInterval(timer);
  }, [length, intervalMs]);
  return length < 2 ? 0 : tick % length;
}
