import { registerDisposableCache, type CacheBudget } from '../notes/cache-budget.js';
import { desktopMetrics } from '../run-activity/diagnostic-metrics.js';
import type { ToolOutputReadResult } from './tool-output-reader.js';

type RetainedOutput = Exclude<ToolOutputReadResult, { status: 'unavailable' }>;
type CacheEntry = { result: RetainedOutput; bytes: number };
const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/** One window-wide budget; cache keys never hold a reader, Host client, or view. */
class ToolOutputCache {
  private readonly entries = new Map<string, CacheEntry>();
  private retainedBytes = 0;
  private maxEntries = DEFAULT_MAX_ENTRIES;
  private maxBytes = DEFAULT_MAX_BYTES;
  private generation = 0;
  private readerSequence = 0;

  public allocateReaderId(): number { return ++this.readerSequence; }
  public getGeneration(): number { return this.generation; }

  public get(key: string): RetainedOutput | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.result;
  }

  public remember(key: string, result: RetainedOutput, generation: number): void {
    // A pressure/manual trim also invalidates work that was already in flight.
    if (generation !== this.generation || this.maxEntries === 0 || this.maxBytes === 0) return;
    const bytes = key.length * 2 + 128 + (result.status === 'ready' ? result.output.length * 2 : 0);
    if (bytes > this.maxBytes) return;
    this.remove(key);
    this.entries.set(key, { result, bytes });
    this.retainedBytes += bytes;
    this.trim();
  }

  public applyBudget(budget: CacheBudget): void {
    this.maxEntries = budget.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.maxBytes = budget.maxBytes ?? DEFAULT_MAX_BYTES;
    if (budget.evictAll || this.maxEntries === 0 || this.maxBytes === 0) {
      this.entries.clear();
      this.retainedBytes = 0;
      this.generation += 1;
    }
    this.trim();
  }

  public estimate(): { entries: number; bytes: number } {
    return { entries: this.entries.size, bytes: this.retainedBytes };
  }

  private remove(key: string): void {
    const previous = this.entries.get(key);
    if (previous === undefined) return;
    this.retainedBytes -= previous.bytes;
    this.entries.delete(key);
  }

  private trim(): void {
    while (this.entries.size > this.maxEntries || this.retainedBytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.remove(oldest);
    }
  }
}

export const toolOutputCache = new ToolOutputCache();
registerDisposableCache({ name: 'historicalToolOutputs', applyBudget: budget => toolOutputCache.applyBudget(budget) });
desktopMetrics.registerCacheProvider('historicalToolOutputs', () => toolOutputCache.estimate());
