/**
 * Multi-bounded LRU Cache for syntax highlight results.
 *
 * Implements strict memory bounds:
 * - maxEntries: 100 code blocks
 * - maxBytes: 10 MB total cache size
 * - maxSourceBytesPerEntry: 1 MB (oversized blocks bypass cache)
 */
import { desktopMetrics } from '../diagnostic-metrics';
import type { TokenLine } from './highlight-protocol';

export type HighlightCacheEntry = {
  tokenLines: TokenLine[];
  byteSize: number;
  lastAccessedAt: number;
};

export class HighlightLruCache {
  private readonly entries = new Map<string, HighlightCacheEntry>();
  private totalBytes = 0;

  constructor(
    public readonly maxEntries = 100,
    public readonly maxBytes = 10 * 1024 * 1024,
    public readonly maxSourceBytesPerEntry = 1 * 1024 * 1024,
  ) {}

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

    // If key exists, subtract old size first
    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.byteSize;
      this.entries.delete(key);
    }

    // Evict oldest entries until within bounds
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
