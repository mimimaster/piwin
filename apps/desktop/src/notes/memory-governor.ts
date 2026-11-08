/**
 * Frontend Memory Governor for WebContent degradation & recovery.
 *
 * Implements multi-tier degradation under high memory pressure:
 * Level 0 (Normal): Full features (Shiki highlight, caching, glass surfaces).
 * Level 1 (Moderate): Purge disposable cache contents (warm transcripts,
 *   rendered mermaid SVGs, idle media object URLs, artifact data URLs) and
 *   strip GPU-expensive CSS (backdrop-filter compositor layers) via the
 *   html[data-memory-pressure] attribute consumed by
 *   styles/memory-degradation.css.
 * Level 2 (Critical / Safe Mode): Additionally disable syntax highlighting
 *   (plain text fallback), stop admitting new disposable cache entries, shed
 *   decorative theme textures, and evict non-forceKeep live artifact iframes
 *   via artifact-memory-bridge.ts.
 *
 * Cache trims are budget-driven (S05): each named cache self-registers a
 * DisposableCache with notes/cache-budget.ts at module load, and the governor
 * pushes DISPOSABLE_CACHE_BUDGETS[level] through applyAllCacheBudgets on every
 * transition — including back to normal, which restores the module caps so
 * disposable entries are admitted again. Leased/owned entries (leased media
 * object URLs, artifact media with pending consumers) are never evicted.
 *
 * Pressure samples reach the governor through memory-pressure.ts
 * (installMemoryPressureBridge); this module stays free of Tauri/event glue
 * so it can be driven directly in tests. Subscribers perform the artifact
 * eviction — the governor itself does not import @piwin/artifact.
 */
import {
  applyAllCacheBudgets,
  type CacheBudget,
  type MemoryPressureLevel,
} from './cache-budget.js';

export type { CacheBudget, DisposableCache, MemoryPressureLevel } from './cache-budget.js';
export {
  applyAllCacheBudgets,
  hasDisposableCache,
  registerDisposableCache,
} from './cache-budget.js';

export type MemoryGovernorListener = (level: MemoryPressureLevel) => void;

const MIB = 1024 * 1024;

/**
 * Warm-session projections: transcript JSON stashed for instant paint on
 * switch-back. Budget is GLOBAL across cache instances (panes) — see
 * trimAllWarmSessionCaches in session-warm-cache.ts.
 */
const WARM_NORMAL_MAX_ENTRIES = 2;
const WARM_NORMAL_MAX_BYTES = 8 * MIB;
const WARM_NORMAL_MAX_AGE_MS = 5 * 60 * 1000;
const WARM_RECLAIM_MAX_ENTRIES = 1;
const WARM_RECLAIM_MAX_BYTES = 2 * MIB;

const HIGHLIGHT_NORMAL_MAX_ENTRIES = 100;
const HIGHLIGHT_NORMAL_MAX_BYTES = 10 * MIB;
const HIGHLIGHT_RECLAIM_MAX_BYTES = 2 * MIB;

const MERMAID_NORMAL_MAX_ENTRIES = 64;
const MERMAID_NORMAL_MAX_BYTES = 4 * MIB;
const MERMAID_RECLAIM_MAX_BYTES = 1 * MIB;

/** Media object-URL cache: budget.maxEntries is the IDLE tail cap; leased URLs are untouchable. */
const MEDIA_IDLE_NORMAL = 6;

const ARTIFACT_MEDIA_NORMAL_MAX_ENTRIES = 32;
const ARTIFACT_MEDIA_NORMAL_MAX_BYTES = 16 * MIB;
const ARTIFACT_MEDIA_RECLAIM_MAX_BYTES = 4 * MIB;

/**
 * Per-level budget table (memory plan S05).
 * - normal: module-default caps; restores admission after a restricted level.
 * - moderate ("reclaim"): evictAll flushes disposable contents now; the byte
 *   caps bound what refills afterwards.
 * - critical: zero caps → evict everything evictable and admit nothing new.
 *   "Unused" is per cache: warm/highlight/mermaid track no leases, so every
 *   entry is disposable; media URLs keep leased entries; artifact media keeps
 *   entries with pending consumers.
 */
export const DISPOSABLE_CACHE_BUDGETS: Record<MemoryPressureLevel, Record<string, CacheBudget>> = {
  normal: {
    warmSessions: {
      maxEntries: WARM_NORMAL_MAX_ENTRIES,
      maxBytes: WARM_NORMAL_MAX_BYTES,
      maxAgeMs: WARM_NORMAL_MAX_AGE_MS,
    },
    highlightCache: {
      maxEntries: HIGHLIGHT_NORMAL_MAX_ENTRIES,
      maxBytes: HIGHLIGHT_NORMAL_MAX_BYTES,
    },
    mermaidDiagrams: {
      maxEntries: MERMAID_NORMAL_MAX_ENTRIES,
      maxBytes: MERMAID_NORMAL_MAX_BYTES,
    },
    mediaPreviewUrls: { maxEntries: MEDIA_IDLE_NORMAL },
    artifactMediaDataUrls: {
      maxEntries: ARTIFACT_MEDIA_NORMAL_MAX_ENTRIES,
      maxBytes: ARTIFACT_MEDIA_NORMAL_MAX_BYTES,
    },
  },
  moderate: {
    warmSessions: {
      maxEntries: WARM_RECLAIM_MAX_ENTRIES,
      maxBytes: WARM_RECLAIM_MAX_BYTES,
      maxAgeMs: WARM_NORMAL_MAX_AGE_MS,
    },
    highlightCache: {
      evictAll: true,
      maxEntries: HIGHLIGHT_NORMAL_MAX_ENTRIES,
      maxBytes: HIGHLIGHT_RECLAIM_MAX_BYTES,
    },
    mermaidDiagrams: {
      evictAll: true,
      maxEntries: MERMAID_NORMAL_MAX_ENTRIES,
      maxBytes: MERMAID_RECLAIM_MAX_BYTES,
    },
    mediaPreviewUrls: { evictAll: true, maxEntries: 0 },
    artifactMediaDataUrls: {
      evictAll: true,
      maxEntries: ARTIFACT_MEDIA_NORMAL_MAX_ENTRIES,
      maxBytes: ARTIFACT_MEDIA_RECLAIM_MAX_BYTES,
    },
  },
  critical: {
    warmSessions: { maxEntries: 0, maxBytes: 0 },
    highlightCache: { evictAll: true, maxEntries: 0, maxBytes: 0 },
    mermaidDiagrams: { evictAll: true, maxEntries: 0, maxBytes: 0 },
    mediaPreviewUrls: { evictAll: true, maxEntries: 0 },
    artifactMediaDataUrls: { evictAll: true, maxEntries: 0, maxBytes: 0 },
  },
};

class MemoryGovernor {
  private level: MemoryPressureLevel = 'normal';
  private readonly listeners = new Set<MemoryGovernorListener>();

  public getLevel = (): MemoryPressureLevel => {
    return this.level;
  };

  public getDegradationLevel = (): MemoryPressureLevel => {
    return this.level;
  };

  public isHighlightDisabled = (): boolean => {
    return this.level === 'critical';
  };

  /**
   * True only while pressure is normal — prefetch/speculative cache work must
   * check this before admitting entries nobody asked for.
   */
  public canAdmitDisposable = (): boolean => {
    return this.level === 'normal';
  };

  /** The budget a named cache would be pushed right now (introspection/tests). */
  public getDisposableBudget = (name: string): CacheBudget | undefined => {
    return DISPOSABLE_CACHE_BUDGETS[this.level][name];
  };

  public subscribe = (listener: MemoryGovernorListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Applies degradation actions according to the target memory pressure level.
   */
  public setLevel = (nextLevel: MemoryPressureLevel): void => {
    if (this.level === nextLevel) return;
    this.level = nextLevel;

    // Budget-driven reclaim: every registered disposable cache trims to its
    // per-level caps. Highlight's "clear on moderate" is preserved via
    // evictAll + a 2 MiB refill budget; critical admits nothing new.
    applyAllCacheBudgets(DISPOSABLE_CACHE_BUDGETS[nextLevel]);

    // The degradation stylesheet keys off this attribute to destroy
    // backdrop-filter layers, letting WebKit return their IOSurface memory.
    if (typeof document !== 'undefined') {
      if (nextLevel === 'normal') {
        delete document.documentElement.dataset.memoryPressure;
      } else {
        document.documentElement.dataset.memoryPressure = nextLevel;
      }
    }

    // Notify listeners (highlight UI, artifact-memory-bridge).
    for (const listener of this.listeners) {
      try {
        listener(nextLevel);
      } catch (err) {
        console.warn('[memory-governor] listener error:', err);
      }
    }
  };

  public reset = (): void => {
    this.setLevel('normal');
  };
}

export const globalMemoryGovernor = new MemoryGovernor();

// Push the 'normal' budget once at module load: caches whose local defaults
// are looser than the table (and the module-global warm admission budget,
// which is empty until a transition) get the correct cap before the first
// pressure event rather than only after a real transition occurs.
applyAllCacheBudgets(DISPOSABLE_CACHE_BUDGETS.normal);
