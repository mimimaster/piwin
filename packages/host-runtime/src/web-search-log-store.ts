/**
 * Cross-session `web_search` call log.
 *
 * Append-only JSONL under `~/.piwin/logs/`. Queries are user data, so the log
 * stays local, is bounded to the most recent rows, and can be cleared from
 * Settings. Writes are serialized per file so compaction never races appends.
 */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  WebSearchLogEntry,
  WebSearchLogPage,
  WebSearchLogRecord,
  WebSearchLogSink,
  WebSearchLogStatusFilter,
} from '@piwin/contracts';
import {
  WEB_SEARCH_ATTEMPT_ERROR_MAX_CHARS,
  WEB_SEARCH_LOG_QUERY_MAX_CHARS,
  readWebSearchDiagnostics,
  WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
} from '@piwin/contracts';
import { getPiwinWebSearchLogPath } from './paths.js';

/** Rows kept after compaction. */
export const WEB_SEARCH_LOG_MAX_ENTRIES = 1000;
/** Compact once the file holds this many rows, so appends stay cheap. */
const COMPACT_THRESHOLD_ENTRIES = WEB_SEARCH_LOG_MAX_ENTRIES * 1.5;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export type WebSearchLogListOptions = {
  limit?: number;
  offset?: number;
  status?: WebSearchLogStatusFilter;
};

export type WebSearchLogStore = WebSearchLogSink & {
  list(options?: WebSearchLogListOptions): Promise<WebSearchLogPage>;
  clear(): Promise<void>;
  /** Resolves once queued writes have landed. */
  flush(): Promise<void>;
};

const stores = new Map<string, WebSearchLogStore>();

/** One store per product root so every session shares the write queue. */
export function getWebSearchLogStore(rootDir: string): WebSearchLogStore {
  const filePath = getPiwinWebSearchLogPath(rootDir);
  const existing = stores.get(filePath);
  if (existing) return existing;
  const created = createWebSearchLogStore(filePath);
  stores.set(filePath, created);
  return created;
}

export function createWebSearchLogStore(filePath: string): WebSearchLogStore {
  let queue: Promise<void> = Promise.resolve();
  /** Row count since the last full read; null until known. */
  let rowCount: number | null = null;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readEntries(): Promise<WebSearchLogEntry[]> {
    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const entries: WebSearchLogEntry[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const entry = parseEntry(line);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  return {
    record(record) {
      const entry = toEntry(record);
      void enqueue(async () => {
        await mkdir(dirname(filePath), { recursive: true });
        await appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
        if (rowCount === null) {
          rowCount = (await readEntries()).length;
        } else {
          rowCount += 1;
        }
        if (rowCount >= COMPACT_THRESHOLD_ENTRIES) {
          const kept = (await readEntries()).slice(-WEB_SEARCH_LOG_MAX_ENTRIES);
          await writeFile(filePath, kept.map((row) => `${JSON.stringify(row)}\n`).join(''), 'utf8');
          rowCount = kept.length;
        }
      }).catch((error: unknown) => {
        console.warn(
          `[web-search-log] failed to record search call: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    },

    list(options = {}) {
      return enqueue(async () => {
        const limit = clampInteger(options.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
        const all = await readEntries();
        rowCount = all.length;
        const newestFirst = all.reverse();
        const filtered =
          options.status === 'failed'
            ? newestFirst.filter((entry) => !entry.ok || entry.attempts.some((a) => !a.ok))
            : newestFirst;
        const offset = clampInteger(options.offset, 0, 0, Math.max(0, filtered.length - 1));
        return {
          entries: filtered.slice(offset, offset + limit),
          total: filtered.length,
          offset,
          limit,
        };
      });
    },

    clear() {
      return enqueue(async () => {
        await rm(filePath, { force: true });
        rowCount = 0;
      });
    },

    flush() {
      return enqueue(async () => undefined);
    },
  };
}

function toEntry(record: WebSearchLogRecord): WebSearchLogEntry {
  const diagnostics = readWebSearchDiagnostics({
    ...record,
    kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
  });
  const entry: WebSearchLogEntry = {
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
    sessionId: record.sessionId,
    query: record.query.slice(0, WEB_SEARCH_LOG_QUERY_MAX_CHARS),
    ok: record.ok,
    providerId: record.providerId,
    hitCount: diagnostics?.hitCount ?? 0,
    durationMs: diagnostics?.durationMs ?? 0,
    attempts: diagnostics?.attempts ?? [],
  };
  if (!record.ok && record.error) {
    entry.error = record.error.slice(0, WEB_SEARCH_ATTEMPT_ERROR_MAX_CHARS);
  }
  return entry;
}

function parseEntry(line: string): WebSearchLogEntry | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Partial<WebSearchLogEntry>;
  if (
    typeof row.id !== 'string' ||
    typeof row.recordedAt !== 'string' ||
    typeof row.sessionId !== 'string' ||
    typeof row.query !== 'string' ||
    typeof row.ok !== 'boolean'
  ) {
    return null;
  }
  const diagnostics = readWebSearchDiagnostics({ ...row, kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND });
  if (!diagnostics) return null;
  const entry: WebSearchLogEntry = {
    id: row.id,
    recordedAt: row.recordedAt,
    sessionId: row.sessionId,
    query: row.query,
    ok: row.ok,
    providerId: diagnostics.providerId,
    hitCount: diagnostics.hitCount,
    durationMs: diagnostics.durationMs,
    attempts: diagnostics.attempts,
  };
  if (typeof row.error === 'string' && row.error.length > 0) entry.error = row.error;
  return entry;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}
