/**
 * Shared trim/admission contract for the disposable render caches driven by
 * the memory governor (S05).
 *
 * The governor owns the per-level budget table; each named cache module
 * registers a `DisposableCache` here at module load and the governor pushes
 * `applyBudget` on level transitions. Keeping the registry in a leaf module
 * means cache modules never import the governor (and the governor never
 * imports them), so there is no import cycle.
 */

export type MemoryPressureLevel = 'normal' | 'moderate' | 'critical';

/**
 * Trim target + admission caps pushed to a cache on a level transition.
 * Undefined fields keep the module's own defaults (the governor table is
 * explicit for every named cache, so this is for custom probes/tests).
 */
export type CacheBudget = {
  /** Max retained entries (per-cache meaning; media URLs: max *idle* tail). */
  readonly maxEntries?: number;
  /** Max retained bytes under the cache's own byte estimate. */
  readonly maxBytes?: number;
  /** Entries older than this (by recency stamp) are evicted regardless. */
  readonly maxAgeMs?: number;
  /**
   * Reclaim event: evict every evictable entry now, while `maxEntries` /
   * `maxBytes` still cap later admissions ("clear, then refill bounded").
   * Entries with a live lease/owner are never evictable.
   */
  readonly evictAll?: boolean;
};

export type DisposableCache = {
  readonly name: string;
  /**
   * Apply the budget: update admission caps, then evict until within them.
   * Must be idempotent and must never evict entries with a live lease.
   */
  applyBudget(budget: CacheBudget): void;
};

const caches = new Map<string, DisposableCache>();
/** Last budgets the governor pushed; applied to caches that register later. */
let currentBudgetsByName: Record<string, CacheBudget> = {};

/**
 * Register a named cache for governor-driven trims. Re-registering a name
 * replaces the prior entry (module re-eval / tests). Returns an unregister.
 */
export function registerDisposableCache(cache: DisposableCache): () => void {
  caches.set(cache.name, cache);
  const pending = currentBudgetsByName[cache.name];
  if (pending !== undefined) {
    // Governor already pushed a restricted budget before this module loaded.
    try {
      cache.applyBudget(pending);
    } catch (error) {
      console.warn('[cache-budget] initial applyBudget failed:', cache.name, error);
    }
  }
  return () => {
    if (caches.get(cache.name) === cache) {
      caches.delete(cache.name);
    }
  };
}

/**
 * Push one level's budget table to every registered cache. Called by the
 * governor on each level transition (including back to normal so caps are
 * restored and disposable entries are admitted again).
 */
export function applyAllCacheBudgets(budgets: Readonly<Record<string, CacheBudget>>): void {
  currentBudgetsByName = { ...budgets };
  for (const [name, budget] of Object.entries(budgets)) {
    const cache = caches.get(name);
    if (cache === undefined) continue;
    try {
      cache.applyBudget(budget);
    } catch (error) {
      console.warn('[cache-budget] applyBudget failed:', name, error);
    }
  }
}

/** Test/introspection hook: is a cache currently registered under `name`? */
export function hasDisposableCache(name: string): boolean {
  return caches.has(name);
}

/**
 * True while any owner of a coalesced inflight request is still live.
 * An empty set means "no caller supplied a staleness probe" → treated live.
 */
export function anyOwnerLive(staleChecks: ReadonlySet<() => boolean>): boolean {
  for (const isStale of staleChecks) {
    if (!isStale()) return true;
  }
  // Zero probes = unconditional ownership; all-probes-stale = nobody cares.
  return staleChecks.size === 0;
}
