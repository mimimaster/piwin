/**
 * Multi-bounded LRU Cache for syntax highlight results.
 *
 * Implements strict memory bounds:
 * - maxEntries: 100 code blocks
 * - maxBytes: 10 MB total cache size
 * - maxSourceBytesPerEntry: 1 MB (oversized blocks bypass cache)
 */
import { desktopMetrics } from '../run-activity/diagnostic-metrics';
import type { CacheBudget } from '../notes/cache-budget.js';
import { registerDisposableCache } from '../notes/cache-budget.js';
import type { TokenLine } from './highlight-protocol';

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_SOURCE_BYTES_PER_ENTRY = 1 * 1024 * 1024;

export type HighlightCacheEntry = {
  tokenLines: TokenLine[];
  byteSize: number;
  lastAccessedAt: number;
};

export class HighlightLruCache {
  private readonly entries = new Map<string, HighlightCacheEntry>();
  private totalBytes = 0;
  public maxEntries: number;
  public maxBytes: number;
  public readonly maxSourceBytesPerEntry: number;

  constructor(
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxBytes = DEFAULT_MAX_BYTES,
    maxSourceBytesPerEntry = DEFAULT_MAX_SOURCE_BYTES_PER_ENTRY,
  ) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.maxSourceBytesPerEntry = maxSourceBytesPerEntry;
  }

  public get(key: string): TokenLine[] | null {
    const entry = this.entries.get(key);
    if (!entry) return null;

    // Refresh LRU order (delete & re-insert)
    entry.lastAccessedAt = Date.now();
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry.tokenLines;
  }

  public set(key: string, tokenLines: TokenLine[], sourceBytes: number): void {
    if (sourceBytes > this.maxSourceBytesPerEntry) {
      // Oversized code blocks bypass cache to avoid memory spikes
      return;
    }

    // Estimate memory consumed by tokenLines: ~64 bytes per token span
    let tokenCount = 0;
    for (const line of tokenLines) {
      tokenCount += line.length;
    }
    const estimatedEntryBytes = Math.max(sourceBytes * 2, tokenCount * 64);

    // Admission rejects a single oversized entry outright — even an empty
    // cache (or every older entry already evicted) must not admit it, so we
    // never evict-everything-then-store-over-budget. Zero caps (critical
    // pressure) mean no new disposable entries at all.
    if (this.maxEntries <= 0 || estimatedEntryBytes > this.maxBytes) {
      return;
    }

    // If key exists, subtract old size first
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.byteSize;
      this.entries.delete(key);
    }

    // Evict oldest entries until the new one fits
    while (
      (this.entries.size >= this.maxEntries ||
        this.totalBytes + estimatedEntryBytes > this.maxBytes) &&
      this.entries.size > 0
    ) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldestEntry = this.entries.get(oldestKey);
      if (oldestEntry) {
        this.totalBytes -= oldestEntry.byteSize;
      }
      this.entries.delete(oldestKey);
    }

    this.entries.set(key, {
      tokenLines,
      byteSize: estimatedEntryBytes,
      lastAccessedAt: Date.now(),
    });
    this.totalBytes += estimatedEntryBytes;
    desktopMetrics.setHighlightCacheBytes(this.totalBytes);
  }

  /**
   * Governor-driven trim: update caps, evict LRU-first until within them.
   * `evictAll` clears contents now while the caps bound the refill.
   * Highlight entries carry no lease concept — every entry is disposable.
   */
  public applyBudget(budget: CacheBudget): void {
    this.maxEntries = budget.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = budget.maxBytes ?? DEFAULT_MAX_BYTES;
    this.trimToBudget(budget);
  }

  public trimToBudget(budget: CacheBudget): void {
    if (budget.evictAll) {
      this.clear();
      return;
    }
    const maxEntries = budget.maxEntries ?? this.maxEntries;
    const maxBytes = budget.maxBytes ?? this.maxBytes;
    while (this.entries.size > maxEntries || this.totalBytes > maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      const oldestEntry = this.entries.get(oldestKey);
      if (oldestEntry) {
        this.totalBytes -= oldestEntry.byteSize;
      }
      this.entries.delete(oldestKey);
    }
    desktopMetrics.setHighlightCacheBytes(this.totalBytes);
  }

  /** Re-admission path after a restricted level: restore default caps. */
  public restoreDefaultBudget(): void {
    this.applyBudget({});
  }

  public clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
    desktopMetrics.setHighlightCacheBytes(0);
  }

  public getTotalBytes(): number {
    return this.totalBytes;
  }

  public getEntryCount(): number {
    return this.entries.size;
  }
}

export const globalHighlightCache = new HighlightLruCache();

registerDisposableCache({
  name: 'highlightCache',
  applyBudget(budget: CacheBudget): void {
    globalHighlightCache.applyBudget(budget);
  },
});
