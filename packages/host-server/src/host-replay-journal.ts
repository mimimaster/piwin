import type { HostSequencedPush } from '@piwin/contracts';

export type HostReplayJournalOptions = {
  maxBytes?: number;
  maxItems?: number;
  maxAgeMs?: number;
  now?: () => number;
};

export type HostReplayJournalEntry = {
  record: HostSequencedPush;
  encodedBytes: number;
  createdAt: number;
};

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_ITEMS = 50_000;
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

/** Byte-, item-, and age-bounded canonical replay storage. */
export class HostReplayJournal {
  private readonly maxBytes: number;
  private readonly maxItems: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  private readonly entries: HostReplayJournalEntry[] = [];
  private totalBytes = 0;

  public constructor(options: HostReplayJournalOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.now = options.now ?? Date.now;
    if (this.maxBytes <= 0 || this.maxItems <= 0 || this.maxAgeMs <= 0) {
      throw new Error('Host replay journal budgets must be greater than zero');
    }
  }

  public append(record: HostSequencedPush): void {
    const createdAt = this.now();
    const encodedBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
    this.entries.push({ record, encodedBytes, createdAt });
    this.totalBytes += encodedBytes;
    this.prune(createdAt);
  }

  public listSince(sequence: number): HostSequencedPush[] {
    this.prune(this.now());
    return this.entries.filter((entry) => entry.record.seq > sequence).map((entry) => entry.record);
  }

  public isCompleteSince(sequence: number): boolean {
    this.prune(this.now());
    const oldest = this.entries[0]?.record.seq;
    // An empty journal cannot prove continuity for any gap. Callers that know
    // the live head (egress hub) treat `sinceSeq >= currentSeq` as complete.
    if (oldest === undefined) {
      return false;
    }
    return sequence >= oldest - 1;
  }

  public getOldestSeq(): number | undefined {
    this.prune(this.now());
    return this.entries[0]?.record.seq;
  }

  public getSize(): { items: number; bytes: number } {
    this.prune(this.now());
    return { items: this.entries.length, bytes: this.totalBytes };
  }

  private prune(now: number): void {
    const cutoff = now - this.maxAgeMs;
    while (this.entries.length > 0) {
      const first = this.entries[0];
      if (first === undefined) break;
      const overItems = this.entries.length > this.maxItems;
      const overBytes = this.totalBytes > this.maxBytes;
      const expired = first.createdAt < cutoff;
      if (!overItems && !overBytes && !expired) break;
      this.entries.shift();
      this.totalBytes -= first.encodedBytes;
    }
  }
}
