/**
 * Durable JobRecord persistence store.
 *
 * Persists JobRecords to a JSON file on disk so that the host can
 * reconcile job state across restarts. Writes are debounced to avoid
 * disk thrash on rapid mutations (e.g. log cursor updates).
 *
 * The store is intentionally simple: a single JSON object mapping
 * jobId → JobRecord, serialized atomically via a temp-file rename. Terminal
 * history is bounded by a retention policy (see job-record-retention.ts) so
 * each flush stays small no matter how many jobs the host has run.
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { JobRecord } from '@piwin/contracts';
import { isJobTerminal } from '@piwin/contracts';

import {
  DEFAULT_JOB_RECORD_RETENTION,
  selectPrunableJobRecordIds,
  type JobRecordRetentionPolicy,
} from './job-record-retention.js';

/** Debounce window for batched writes (ms). */
const DEFAULT_FLUSH_DEBOUNCE_MS = 500;

/** Public interface for the record store — allows mocking in tests. */
export interface JobRecordStore {
  /** Persist a single record (debounced). */
  save(record: JobRecord): void;
  /** Load all stored records from the in-memory map. */
  loadAll(): JobRecord[];
  /** Remove a record by jobId (debounced). */
  remove(jobId: string): void;
  /** Flush pending writes and release resources. */
  dispose(): Promise<void>;
}

/** Options for creating a file-backed JobRecordStore. */
export interface JobRecordStoreOptions {
  /** Debounce window for batched writes (ms). */
  flushDebounceMs?: number;
  /** Bounds on durable terminal history. Defaults to DEFAULT_JOB_RECORD_RETENTION. */
  retention?: Partial<JobRecordRetentionPolicy>;
  /** Inject clock for retention age checks (ms since epoch). */
  now?: () => number;
}

/**
 * In-memory record store that never touches disk. Used when persistence
 * is not required or as a test double.
 */
export function createMemoryRecordStore(): JobRecordStore {
  const records = new Map<string, JobRecord>();

  return {
    save(record: JobRecord): void {
      records.set(record.jobId, { ...record, argv: [...record.argv] });
    },
    loadAll(): JobRecord[] {
      return Array.from(records.values()).map((record) => ({
        ...record,
        argv: [...record.argv],
      }));
    },
    remove(jobId: string): void {
      records.delete(jobId);
    },
    async dispose(): Promise<void> {
      // No-op for in-memory store.
    },
  };
}

/**
 * File-backed durable JobRecord store.
 *
 * On first access (loadAll or save), reads the JSON file (if it exists)
 * into an in-memory map. Subsequent save/remove calls mutate the map and
 * schedule a debounced flush that serializes the entire map to disk
 * atomically via temp-file rename. Old terminal records are pruned on load
 * and whenever a terminal record is saved.
 */
export function createFileRecordStore(
  filePath: string,
  options: JobRecordStoreOptions = {},
): JobRecordStore {
  const flushDebounceMs = options.flushDebounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;
  const retention: JobRecordRetentionPolicy = {
    ...DEFAULT_JOB_RECORD_RETENTION,
    ...options.retention,
  };
  const now = options.now ?? Date.now;
  const records = new Map<string, JobRecord>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushInFlight: Promise<void> | null = null;
  let disposed = false;
  let loaded = false;

  /**
   * Loads records from disk on first access. After that the in-memory
   * map is the source of truth. A sync read is acceptable here because
   * loadAll() is called once during registry creation before any jobs
   * are started.
   */
  function ensureLoaded(): void {
    if (loaded) return;
    loaded = true;
    try {
      const data = readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data) as Record<string, JobRecord>;
      for (const [id, record] of Object.entries(parsed)) {
        records.set(id, { ...record, argv: [...record.argv] });
      }
    } catch {
      // File doesn't exist or is corrupt — start with an empty store.
    }
    // Shrink history written before retention existed (or under looser
    // limits) right away, instead of carrying it until the next job ends.
    if (pruneTerminalHistory()) {
      scheduleFlush();
    }
  }

  /** Drop terminal records outside the retention policy; true if any went. */
  function pruneTerminalHistory(): boolean {
    const prunable = selectPrunableJobRecordIds(records.values(), retention, now());
    for (const jobId of prunable) {
      records.delete(jobId);
    }
    return prunable.length > 0;
  }

  function scheduleFlush(): void {
    if (disposed) return;
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushNow();
    }, flushDebounceMs);
    if (typeof flushTimer.unref === 'function') {
      flushTimer.unref();
    }
  }

  async function flushNow(force = false): Promise<void> {
    if (disposed && !force) return;
    // Wait out any in-flight write instead of returning: a save that lands
    // while the previous snapshot is being written would otherwise never
    // reach disk, because nothing schedules a later flush for it.
    while (flushInFlight) {
      await flushInFlight;
    }
    const snapshot: Record<string, JobRecord> = {};
    for (const [id, record] of records) {
      snapshot[id] = { ...record, argv: [...record.argv] };
    }
    // Compact: the file is machine-only and indentation roughly doubles it.
    const json = JSON.stringify(snapshot);
    const dir = dirname(filePath);
    flushInFlight = (async () => {
      await mkdir(dir, { recursive: true });
      // Atomic write via temp-file rename to avoid partial writes.
      const tmpPath = join(dir, `.records.${randomBytes(6).toString('hex')}.tmp`);
      await writeFile(tmpPath, json, 'utf8');
      await rename(tmpPath, filePath);
    })();
    try {
      await flushInFlight;
    } finally {
      flushInFlight = null;
    }
  }

  return {
    save(record: JobRecord): void {
      if (disposed) return;
      ensureLoaded();
      records.set(record.jobId, { ...record, argv: [...record.argv] });
      // Only a terminal save can push history past the policy.
      if (isJobTerminal(record.status)) {
        pruneTerminalHistory();
      }
      scheduleFlush();
    },

    loadAll(): JobRecord[] {
      ensureLoaded();
      return Array.from(records.values()).map((record) => ({
        ...record,
        argv: [...record.argv],
      }));
    },

    remove(jobId: string): void {
      if (disposed) return;
      ensureLoaded();
      records.delete(jobId);
      scheduleFlush();
    },

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      // The final terminal records must be durable before the Host releases
      // the registry. `force` allows this one flush after closing admission.
      await flushNow(true);
    },
  };
}
