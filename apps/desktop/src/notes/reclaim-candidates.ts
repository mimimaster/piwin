/**
 * S06 candidate enumeration + release for the production coordinator.
 *
 * This module is deliberately thin: it reads the registries that already
 * exist (warm-cache handles, diagnostic-metrics cache providers, the
 * session-render-resources presentation registry) and maps coordinator keys
 * back to the concrete release mechanisms. All scoring constants live here
 * so the policy module stays mechanism-free.
 *
 * Byte estimates are diagnostic-grade: every source over- or under-counts a
 * little (serialized JSON dedupes, URL caches hold no bytes at all), and the
 * ledger records estimates, not accounting.
 */
import { getDisposableCache, type CacheBudget } from './cache-budget.js';
import { globalMemoryGovernor } from './memory-governor.js';
import { desktopMetrics } from '../run-activity/diagnostic-metrics.js';
import { sessionRenderResources } from '../session/session-render-resources.js';
import {
  evictWarmSessionSnapshot,
  listWarmSnapshots,
} from '../session/session-warm-cache.js';
import type { ReclaimCandidate } from './reclaim-policy.js';

const MIB = 1024 * 1024;

/** One non-visible presentation ≈ one iframe + shadow DOM, order-of-magnitude. */
const PRESENTATION_ESTIMATE_BYTES = 8 * MIB;
/** Caches that report entries but no byte estimate get this token size. */
const PER_ENTRY_ESTIMATE_BYTES = 1 * MIB;
/** Warm/caches have no live touch stamp; this puts them mid-sort. */
const CACHE_AGE_MS = 30_000;

const WARM_CACHE_NAME = 'warmSessions';
const PRESENTATION_KEY = 'presentation:non-visible';

/** Map a registered disposable cache to its reclaim kind. */
function cacheKind(name: string): ReclaimCandidate['kind'] {
  if (name === 'mediaPreviewUrls') return 'idle-media';
  return 'cache-entries';
}

/**
 * Snapshot of reclaimable candidates. Warm snapshots are enumerated per
 * session (finest lever — one evicted warm transcript is a real byte win);
 * registered cache providers become one candidate each; non-visible
 * presentations are one aggregate candidate because the registry reclaims
 * them as a batch via requestReclaim().
 */
export function collectReclaimCandidates(nowMs: number = Date.now()): ReclaimCandidate[] {
  const candidates: ReclaimCandidate[] = [];

  for (const snapshot of listWarmSnapshots()) {
    candidates.push({
      kind: 'warm-snapshot',
      key: `warm:${snapshot.sessionId}`,
      estimatedBytes: snapshot.bytes,
      protectionScore: 0,
      lastTouchedMs: Math.max(0, nowMs - snapshot.touchedAt),
      restoreCost: 0.2,
    });
  }

  const estimates = desktopMetrics.collectObservability().cacheEstimates;
  for (const [name, estimate] of Object.entries(estimates)) {
    if (name === WARM_CACHE_NAME) continue; // per-snapshot keys above
    if (estimate.entries === 0 && estimate.bytes === 0) continue;
    candidates.push({
      kind: cacheKind(name),
      key: `cache:${name}`,
      estimatedBytes:
        estimate.bytes > 0 ? estimate.bytes : estimate.entries * PER_ENTRY_ESTIMATE_BYTES,
      protectionScore: 0,
      lastTouchedMs: CACHE_AGE_MS,
      restoreCost: 0.5,
    });
  }

  // Restoring keys are a protection reason (visible-adjacent): they must not
  // count toward the batch-estimate either, or an episode would charge at a
  // presentation the registry itself refuses to release mid-restore.
  const presentations = Math.max(
    0,
    sessionRenderResources.count() - sessionRenderResources.restoringCount(),
  );
  if (presentations > 0) {
    candidates.push({
      kind: 'presentation',
      key: PRESENTATION_KEY,
      estimatedBytes: presentations * PRESENTATION_ESTIMATE_BYTES,
      protectionScore: 0,
      lastTouchedMs: CACHE_AGE_MS,
      restoreCost: 0.7,
    });
  }

  return candidates;
}

/**
 * Release one coordinator key.
 *
 * - `warm:<id>`: drop that snapshot from every registered warm cache.
 * - `cache:<name>`: re-apply the governor's CURRENT budget plus evictAll —
 *   not an ad-hoc budget, so admission caps stay whatever the level dictates
 *   (evictAll alone would fall back to module defaults and briefly re-admit).
 * - `presentation:non-visible`: requestReclaim() re-checks visibility and
 *   the restoring marker at execution time inside the registry, so a pane
 *   that became visible (or started restoring) since enumeration is never
 *   released — that is the lease/visibility guard the coordinator contract
 *   requires.
 */
export async function releaseReclaimCandidate(
  key: string,
  _deadlineMs: number,
): Promise<{ released: number; error?: string }> {
  try {
    if (key.startsWith('warm:')) {
      const sessionId = key.slice('warm:'.length);
      return { released: evictWarmSessionSnapshot(sessionId) };
    }
    if (key.startsWith('cache:')) {
      const name = key.slice('cache:'.length);
      const cache = getDisposableCache(name);
      if (cache === undefined) {
        return { released: 0, error: `no disposable cache named ${name}` };
      }
      const budget: CacheBudget = {
        ...(globalMemoryGovernor.getDisposableBudget(name) ?? {}),
        evictAll: true,
      };
      cache.applyBudget(budget);
      return { released: 0 };
    }
    if (key === PRESENTATION_KEY) {
      sessionRenderResources.requestReclaim();
      return { released: 0 };
    }
    return { released: 0, error: `unknown reclaim key ${key}` };
  } catch (error) {
    return { released: 0, error: String(error) };
  }
}
