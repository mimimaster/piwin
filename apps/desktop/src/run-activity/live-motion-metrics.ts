/**
 * Tracks currently mounted whitelisted status animations so the Memory
 * Diagnostics panel and Host observability bundles can report real active
 * counts instead of guessing per-element WebKit graphics bytes.
 */
import { useEffect } from 'react';
import { desktopMetrics } from './diagnostic-metrics.js';

export type LiveMotionKind =
  | 'radial-bellow'
  | 'asterisk-breath'
  | 'breath-dot'
  | 'breath-matrix';

export type LiveMotionStats = {
  total: number;
  byKind: Record<LiveMotionKind, number>;
};

const EMPTY_COUNTS: Record<LiveMotionKind, number> = {
  'radial-bellow': 0,
  'asterisk-breath': 0,
  'breath-dot': 0,
  'breath-matrix': 0,
};

let counts: Record<LiveMotionKind, number> = { ...EMPTY_COUNTS };

/** Increment one live motion kind and return its paired release callback. */
export function trackLiveMotionMount(kind: LiveMotionKind): () => void {
  counts[kind] += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    counts[kind] = Math.max(0, counts[kind] - 1);
  };
}

/** Snapshot active whitelisted status animation counts by primitive kind. */
export function getLiveMotionStats(): LiveMotionStats {
  const byKind = { ...counts };
  const total =
    byKind['radial-bellow'] +
    byKind['asterisk-breath'] +
    byKind['breath-dot'] +
    byKind['breath-matrix'];
  return { total, byKind };
}

/** Reset counters between unit tests. */
export function resetLiveMotionMetrics(): void {
  counts = { ...EMPTY_COUNTS };
}

/** Track the lifecycle of one mounted status animation primitive. */
export function useTrackLiveMotion(kind: LiveMotionKind | 'none'): void {
  useEffect(() => {
    if (kind === 'none') return;
    return trackLiveMotionMount(kind);
  }, [kind]);
}

desktopMetrics.registerResourceCountProvider(
  'liveStatusAnimations',
  () => getLiveMotionStats().total,
);
