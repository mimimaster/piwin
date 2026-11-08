/**
 * In-memory LRU for rendered Mermaid SVGs and measured heights.
 *
 * Session switch remounts every fence. Without this, each diagram starts at a
 * ~17px "Rendering diagram…" placeholder and then grows as mermaid.render
 * finishes one-by-one — the transcript stick-to-bottom observer jumps on
 * every growth. Cached SVGs paint at full size on the first frame; remembered
 * heights reserve the placeholder when the SVG has been evicted.
 */
import type { ThemeMode } from '../theme/theme-mode.js';
import type { CacheBudget } from '../notes/cache-budget.js';
import { anyOwnerLive, registerDisposableCache } from '../notes/cache-budget.js';
import { desktopMetrics } from '../run-activity/diagnostic-metrics.js';

export const MAX_MERMAID_DIAGRAM_SVG_CACHE_ENTRIES = 64;
export const MAX_MERMAID_DIAGRAM_HEIGHT_CACHE_ENTRIES = 256;
/** SVG byte budget at normal pressure (entry count cap stays 64). */
export const MAX_MERMAID_DIAGRAM_SVG_CACHE_BYTES = 4 * 1024 * 1024;
export const MERMAID_DIAGRAM_MIN_CACHED_HEIGHT_PX = 40;
export const MERMAID_DIAGRAM_MAX_CACHED_HEIGHT_PX = 4_000;

const svgByKey = new Map<string, string>();
const heightPxByKey = new Map<string, number>();
type InflightRender = {
  promise: Promise<string>;
  /** One staleness probe per caller that supplied one; empty = un-probed. */
  staleChecks: Set<() => boolean>;
};
const inflightSvgByKey = new Map<string, InflightRender>();

let totalSvgBytes = 0;
let svgMaxEntries = MAX_MERMAID_DIAGRAM_SVG_CACHE_ENTRIES;
let svgMaxBytes = MAX_MERMAID_DIAGRAM_SVG_CACHE_BYTES;
let heightMaxEntries = MAX_MERMAID_DIAGRAM_HEIGHT_CACHE_ENTRIES;

function mermaidDiagramCacheKey(source: string, themeMode: ThemeMode): string {
  return `${themeMode}\0${source}`;
}

function readLruEntry<T>(map: Map<string, T>, key: string): T | undefined {
  const value = map.get(key);
  if (value === undefined) {
    return undefined;
  }
  map.delete(key);
  map.set(key, value);
  return value;
}

function writeLruEntry<T>(map: Map<string, T>, key: string, value: T, maxEntries: number): void {
  map.delete(key);
  map.set(key, value);
  const oldestKey = map.keys().next().value;
  if (map.size > maxEntries && oldestKey !== undefined) {
    map.delete(oldestKey);
  }
}

export function readMermaidDiagramSvg(source: string, themeMode: ThemeMode): string | null {
  return readLruEntry(svgByKey, mermaidDiagramCacheKey(source, themeMode)) ?? null;
}

export function rememberMermaidDiagramSvg(source: string, themeMode: ThemeMode, svg: string): void {
  // Admission rejects a single oversized SVG even after evicting everything
  // else — a cache entry bigger than the whole budget is never stored.
  if (svgMaxEntries <= 0 || svg.length > svgMaxBytes) {
    return;
  }
  const key = mermaidDiagramCacheKey(source, themeMode);
  deleteSvgEntry(key);
  svgByKey.set(key, svg);
  totalSvgBytes += svg.length;
  trimMermaidDiagramCache({});
}

/** Remove an SVG entry and its byte accounting, if present. */
function deleteSvgEntry(key: string): void {
  const value = svgByKey.get(key);
  if (value !== undefined) {
    svgByKey.delete(key);
    totalSvgBytes -= value.length;
  }
}

export function readMermaidDiagramHeight(source: string, themeMode: ThemeMode): number | null {
  return readLruEntry(heightPxByKey, mermaidDiagramCacheKey(source, themeMode)) ?? null;
}

export function rememberMermaidDiagramHeight(
  source: string,
  themeMode: ThemeMode,
  heightPx: number,
): void {
  if (!Number.isFinite(heightPx) || heightPx < MERMAID_DIAGRAM_MIN_CACHED_HEIGHT_PX / 2) {
    return;
  }
  const clamped = Math.min(MERMAID_DIAGRAM_MAX_CACHED_HEIGHT_PX, Math.ceil(heightPx));
  if (clamped < MERMAID_DIAGRAM_MIN_CACHED_HEIGHT_PX / 2) {
    return;
  }
  if (heightMaxEntries <= 0) {
    return;
  }
  writeLruEntry(
    heightPxByKey,
    mermaidDiagramCacheKey(source, themeMode),
    Math.max(MERMAID_DIAGRAM_MIN_CACHED_HEIGHT_PX, clamped),
    heightMaxEntries,
  );
}

/**
 * Governor-driven trim: update caps, then evict LRU-first until within them.
 * Mermaid entries carry no lease/visible-owner concept — every cached SVG is
 * disposable — so `evictAll` (and a zero budget) drops everything except
 * in-flight renders, which keep their callers.
 */
export function trimMermaidDiagramCache(budget: CacheBudget): void {
  if (budget.maxEntries !== undefined) {
    svgMaxEntries = budget.maxEntries;
    heightMaxEntries = budget.maxEntries;
  }
  if (budget.maxBytes !== undefined) {
    svgMaxBytes = budget.maxBytes;
  }
  if (budget.evictAll) {
    svgByKey.clear();
    heightPxByKey.clear();
    totalSvgBytes = 0;
    return;
  }
  while (svgByKey.size > svgMaxEntries || totalSvgBytes > svgMaxBytes) {
    const oldestKey = svgByKey.keys().next().value;
    if (oldestKey === undefined) break;
    deleteSvgEntry(oldestKey);
  }
  while (heightPxByKey.size > heightMaxEntries) {
    const oldestKey = heightPxByKey.keys().next().value;
    if (oldestKey === undefined) break;
    heightPxByKey.delete(oldestKey);
  }
}

/**
 * Return a cached SVG, join an in-flight render, or start `render`.
 * `isStale` is a generation/visibility probe: when the render finishes after
 * every caller turned stale (e.g. the fence unmounted or re-streamed), the
 * SVG is returned to the waiter but NOT written into the shared cache — a
 * stale completion does not populate the cache it would immediately be
 * trimmed out of. A coalesced render stores its result while ANY owner is
 * still live; callers that pass no probe count as live.
 */
export function getOrCreateMermaidDiagramRender(
  source: string,
  themeMode: ThemeMode,
  render: () => Promise<string>,
  isStale?: () => boolean,
): Promise<string> {
  const cachedSvg = readMermaidDiagramSvg(source, themeMode);
  if (cachedSvg !== null) {
    return Promise.resolve(cachedSvg);
  }
  const key = mermaidDiagramCacheKey(source, themeMode);
  const inflight = inflightSvgByKey.get(key);
  if (inflight) {
    if (isStale !== undefined) {
      inflight.staleChecks.add(isStale);
    }
    return inflight.promise;
  }
  const staleChecks = new Set<() => boolean>();
  if (isStale !== undefined) {
    staleChecks.add(isStale);
  }
  desktopMetrics.incrementActiveDiagram();
  const pending = render()
    .then((svg) => {
      if (anyOwnerLive(staleChecks)) {
        rememberMermaidDiagramSvg(source, themeMode, svg);
      }
      return svg;
    })
    .finally(() => {
      desktopMetrics.decrementActiveDiagram();
      if (inflightSvgByKey.get(key)?.promise === pending) {
        inflightSvgByKey.delete(key);
      }
    });
  inflightSvgByKey.set(key, { promise: pending, staleChecks });
  return pending;
}

export function clearMermaidDiagramCacheForTests(): void {
  svgByKey.clear();
  heightPxByKey.clear();
  inflightSvgByKey.clear();
  totalSvgBytes = 0;
  svgMaxEntries = MAX_MERMAID_DIAGRAM_SVG_CACHE_ENTRIES;
  svgMaxBytes = MAX_MERMAID_DIAGRAM_SVG_CACHE_BYTES;
  heightMaxEntries = MAX_MERMAID_DIAGRAM_HEIGHT_CACHE_ENTRIES;
}

/**
 * Observability counters: entry/inflight totals plus an SVG byte estimate
 * (string length ≈ UTF-16 char count — diagnostics, not accounting).
 */
export function getMermaidDiagramCacheStats(): {
  svgEntries: number;
  heightEntries: number;
  inflight: number;
  svgBytes: number;
} {
  return {
    svgEntries: svgByKey.size,
    heightEntries: heightPxByKey.size,
    inflight: inflightSvgByKey.size,
    svgBytes: totalSvgBytes,
  };
}

registerDisposableCache({
  name: 'mermaidDiagrams',
  applyBudget: trimMermaidDiagramCache,
});

desktopMetrics.registerCacheProvider('mermaidDiagrams', () => {
  const stats = getMermaidDiagramCacheStats();
  return { entries: stats.svgEntries + stats.heightEntries, bytes: stats.svgBytes };
});
