import type {
  WebFetchProvider,
  WebFetchResultProvider,
  WebFetchTruncationReason,
} from '@piwin/contracts';
import { DEFAULT_FETCH_CACHE_MAX_BYTES } from '@piwin/contracts';

export type FetchStoreRecord = {
  url: string;
  finalUrl: string;
  title: string | null;
  text: string;
  contentType: string;
  byteSize: number;
  truncated: boolean;
  truncationReason?: WebFetchTruncationReason;
  outline: string[];
  provider: WebFetchResultProvider;
  thinContent?: boolean;
  pageCount?: number;
  /** System notice — return in full, do not apply the view window. */
  skipView?: boolean;
};

export type FetchCacheEntry = FetchStoreRecord & {
  storedAt: number;
  bytes: number;
};

export type FetchCacheOptions = {
  now?: () => number;
  maxBytes?: number;
};

export function normalizeFetchCacheKey(url: string, provider: WebFetchProvider): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return `${provider}:${parsed.toString()}`;
  } catch {
    return `${provider}:${url.trim()}`;
  }
}

export function estimateFetchStoreBytes(record: FetchStoreRecord): number {
  return Buffer.byteLength(record.text, 'utf8') + Buffer.byteLength(record.outline.join('\n'), 'utf8') + 256;
}

/**
 * In-memory LRU+TTL cache of extracted page text.
 * Permission still runs before execute(); a hit only skips the network.
 */
export class FetchCache {
  private readonly entries = new Map<string, FetchCacheEntry>();
  private readonly now: () => number;
  private readonly maxBytes: number;
  private totalBytes = 0;

  constructor(options: FetchCacheOptions = {}) {
    this.now = options.now ?? Date.now;
    this.maxBytes = options.maxBytes ?? DEFAULT_FETCH_CACHE_MAX_BYTES;
  }

  get(key: string, ttlMs: number): FetchStoreRecord | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (this.now() - entry.storedAt > ttlMs) {
      this.entries.delete(key);
      this.totalBytes -= entry.bytes;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return toStoreRecord(entry);
  }

  set(key: string, record: FetchStoreRecord): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.totalBytes -= existing.bytes;
    }
    const bytes = estimateFetchStoreBytes(record);
    const entry: FetchCacheEntry = {
      ...record,
      storedAt: this.now(),
      bytes,
    };
    this.entries.set(key, entry);
    this.totalBytes += bytes;
    this.evict();
  }

  size(): number {
    return this.entries.size;
  }

  byteSize(): number {
    return this.totalBytes;
  }

  private evict(): void {
    while (this.totalBytes > this.maxBytes && this.entries.size > 1) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) {
        this.totalBytes -= oldest.bytes;
      }
    }
  }
}

function toStoreRecord(entry: FetchCacheEntry): FetchStoreRecord {
  const record: FetchStoreRecord = {
    url: entry.url,
    finalUrl: entry.finalUrl,
    title: entry.title,
    text: entry.text,
    contentType: entry.contentType,
    byteSize: entry.byteSize,
    truncated: entry.truncated,
    outline: entry.outline,
    provider: entry.provider,
  };
  if (entry.truncationReason) {
    record.truncationReason = entry.truncationReason;
  }
  if (entry.thinContent === true) {
    record.thinContent = true;
  }
  if (entry.pageCount !== undefined) {
    record.pageCount = entry.pageCount;
  }
  if (entry.skipView === true) {
    record.skipView = true;
  }
  return record;
}
