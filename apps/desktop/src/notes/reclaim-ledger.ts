/**
 * S06 diagnostic ledger: a bounded ring of completed reclaim episodes.
 *
 * The ring is the only retained memory of an episode after the coordinator
 * drops its live state; `desktopMetrics` exposes `reclaimEpisodes` as a
 * resource-count provider so the count lands in every S02 diagnostics
 * bundle, and `/memory` output can correlate "pressure stayed high" with
 * what the coordinator actually tried.
 */
import { desktopMetrics } from '../run-activity/diagnostic-metrics.js';
import type { EpisodeOutcome } from './reclaim-policy.js';
import type { ReclaimEpisode } from './reclaim-coordinator.js';

export type ReclaimSampleQuality = 'fresh' | 'stale' | 'missing';

/**
 * Per-episode diagnostics derived at terminal time and stored on the
 * recorded episode (see ReclaimEpisode fields in reclaim-coordinator.ts):
 * - `beforeBytes`/`afterBytes`: the episode-boundary main-process footprint
 *   samples, when a fresh sample existed at each boundary.
 * - `eligibleCount`/`protectedCount`/`blockedCount`: candidate census of the
 *   LAST enumeration (`blocked` = attempted this episode).
 * - `lastSampleQuality`: freshness of the most recent sample seen.
 */
export type ReclaimLedgerEntry = ReclaimEpisode;

export const RECLAIM_LEDGER_MAX_EPISODES = 32;

const episodes: ReclaimLedgerEntry[] = [];

export function recordReclaimEpisode(episode: ReclaimEpisode): void {
  episodes.push(episode);
  if (episodes.length > RECLAIM_LEDGER_MAX_EPISODES) {
    episodes.splice(0, episodes.length - RECLAIM_LEDGER_MAX_EPISODES);
  }
}

/** Oldest → newest. Returns a copy — callers cannot mutate the ring. */
export function listReclaimEpisodes(): ReclaimLedgerEntry[] {
  return episodes.slice();
}

export function latestReclaimOutcome(): EpisodeOutcome | undefined {
  const latest = episodes[episodes.length - 1];
  return latest?.outcome;
}

/** Test hook: drop the ring between cases. */
export function resetReclaimLedger(): void {
  episodes.length = 0;
}

desktopMetrics.registerResourceCountProvider('reclaimEpisodes', () => episodes.length);
