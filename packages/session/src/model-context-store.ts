/**
 * Per-session Model Visibility Ledger. Independent from transcript.sqlite3.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  ContextSummaryPush,
  ModelContextCoverage,
  ModelContextEventType,
} from '@piwin/contracts';
import { isModelContextCoverage } from '@piwin/contracts';

export type ModelContextStoreOptions = {
  dbPath: string;
  sessionId: string;
};

export type ModelContextAppendEventInput = {
  type: ModelContextEventType;
  payload: unknown;
  eventId?: string;
  runId?: string;
  runtimeGenerationId?: string;
  requestClass?: string;
  requestOrdinal?: number;
  idempotencyKey?: string;
  createdAt?: string;
  blobDigests?: string[];
};

export type ModelContextCopiedEvent = {
  seq: number;
  eventId: string;
  type: ModelContextEventType;
  payload: unknown;
  runId?: string;
  runtimeGenerationId?: string;
  requestClass?: string;
  requestOrdinal?: number;
  idempotencyKey?: string;
  createdAt: string;
  blobDigests?: string[];
};

export type ModelContextCopiedBlob = {
  digest: `sha256:${string}`;
  mediaType: string;
  body: Uint8Array;
};

export type ModelContextStore = {
  putBlob(input: { mediaType: string; body: Uint8Array | string }): Promise<{
    digest: `sha256:${string}`;
    created: boolean;
    byteLength: number;
  }>;
  appendEvent(input: ModelContextAppendEventInput): Promise<{ eventId: string; seq: number }>;
  recordAssembly(summary: ContextSummaryPush): Promise<void>;
  listSummaries(): Promise<ContextSummaryPush[]>;
  listEvents(): Promise<ModelContextCopiedEvent[]>;
  listBlobs(): Promise<ModelContextCopiedBlob[]>;
  getCoverage(): Promise<ModelContextCoverage>;
  setCoverage(coverage: ModelContextCoverage): Promise<void>;
  pruneUnreferencedBlobs(): Promise<number>;
  truncateEventsFrom(seq: number): Promise<{ removedEvents: number; removedBlobs: number }>;
  close(): void;
};

type MetaRow = {
  session_id: string;
  format_version: number;
  revision: number;
  coverage: string;
  updated_at: string;
};

type EventRow = {
  seq: number;
  event_id: string;
  type: string;
  run_id: string | null;
  runtime_generation_id: string | null;
  request_class: string | null;
  request_ordinal: number | null;
  idempotency_key: string | null;
  payload_json: string;
  created_at: string;
};

type BlobRow = {
  digest: string;
  media_type: string;
  body: Uint8Array;
};

const BLOB_DIGEST_REGEX = /^sha256:[a-f0-9]{64}$/i;
const LEGACY_BLOB_DIGEST_SCAN_REGEX = /sha256:[a-f0-9]{64}/gi;
const MODEL_CONTEXT_FORMAT_VERSION = 2;

function normalizeBlobDigest(value: string): string | undefined {
  return BLOB_DIGEST_REGEX.test(value) ? value.toLowerCase() : undefined;
}

function extractLegacyDigests(serialized: string): string[] {
  const digests = new Set<string>();
  for (const match of serialized.matchAll(LEGACY_BLOB_DIGEST_SCAN_REGEX)) {
    const value = match[0];
    if (value !== undefined) digests.add(value.toLowerCase());
  }
  return [...digests];
}

function extractDigestsFromSummary(summary: ContextSummaryPush): string[] {
  const digests = new Set<string>();
  for (const contribution of summary.contributions) {
    const digest = contribution.contentRef?.digest;
    if (digest === undefined) continue;
    const normalized = normalizeBlobDigest(digest);
    if (normalized !== undefined) digests.add(normalized);
  }
  return [...digests];
}

export function digestContent(body: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

export async function openModelContextStore(
  options: ModelContextStoreOptions,
): Promise<ModelContextStore> {
  await mkdir(dirname(options.dbPath), { recursive: true });
  const db = new DatabaseSync(options.dbPath);
  db.exec('PRAGMA busy_timeout = 2000;');
  const autoVacuumRow = db.prepare('PRAGMA auto_vacuum').get() as
    | { auto_vacuum?: number }
    | undefined;
  if (autoVacuumRow?.auto_vacuum !== 2) {
    // SQLite only applies auto_vacuum changes after a VACUUM. This also
    // migrates existing model-context databases created before P3.
    db.exec('PRAGMA auto_vacuum = INCREMENTAL;');
    db.exec('VACUUM;');
  }
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_context_meta (
      session_id TEXT PRIMARY KEY,
      format_version INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      coverage TEXT NOT NULL DEFAULT 'assembly-only',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_context_blob (
      digest TEXT PRIMARY KEY,
      media_type TEXT NOT NULL,
      encoding TEXT NOT NULL DEFAULT 'identity',
      byte_length INTEGER NOT NULL,
      body BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_context_event (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      run_id TEXT,
      runtime_generation_id TEXT,
      request_class TEXT,
      request_ordinal INTEGER,
      idempotency_key TEXT,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_context_event_blob (
      event_seq INTEGER NOT NULL,
      blob_digest TEXT NOT NULL,
      PRIMARY KEY (event_seq, blob_digest)
    );
    CREATE INDEX IF NOT EXISTS idx_mcl_run ON model_context_event(run_id, seq);
    CREATE INDEX IF NOT EXISTS idx_mcl_type ON model_context_event(type, seq);
    CREATE INDEX IF NOT EXISTS idx_mcl_blob_ref ON model_context_event_blob(blob_digest);
  `);

  const now = () => new Date().toISOString();
  const ensureMeta = db.prepare(`
    INSERT OR IGNORE INTO model_context_meta(session_id, format_version, revision, coverage, updated_at)
    VALUES (?, ${MODEL_CONTEXT_FORMAT_VERSION}, 0, 'assembly-only', ?)
  `);
  ensureMeta.run(options.sessionId, now());

  const insertBlob = db.prepare(`
    INSERT OR IGNORE INTO model_context_blob(digest, media_type, encoding, byte_length, body, created_at)
    VALUES (?, ?, 'identity', ?, ?, ?)
  `);
  const hasBlob = db.prepare(`SELECT 1 AS ok FROM model_context_blob WHERE digest = ?`);
  const insertEvent = db.prepare(`
    INSERT INTO model_context_event(
      event_id, type, run_id, runtime_generation_id, request_class, request_ordinal, idempotency_key, payload_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertEventBlob = db.prepare(`
    INSERT OR IGNORE INTO model_context_event_blob(event_seq, blob_digest) VALUES (?, ?)
  `);
  const lastSeq = db.prepare(`SELECT last_insert_rowid() AS seq`);
  const bumpMeta = db.prepare(`
    UPDATE model_context_meta
    SET revision = revision + 1, coverage = ?, updated_at = ?
    WHERE session_id = ?
  `);
  const readMeta = db.prepare(`SELECT * FROM model_context_meta WHERE session_id = ?`);
  const updateFormatVersion = db.prepare(`
    UPDATE model_context_meta
    SET format_version = ?, updated_at = ?
    WHERE session_id = ?
  `);
  const listTurnInputs = db.prepare(`
    SELECT * FROM model_context_event WHERE type = 'turn/input' ORDER BY seq ASC
  `);
  const listAllEvents = db.prepare(`
    SELECT * FROM model_context_event ORDER BY seq ASC
  `);
  const listAllBlobs = db.prepare(`
    SELECT digest, media_type, body FROM model_context_blob
  `);
  const listBlobsForEvent = db.prepare(`
    SELECT blob_digest FROM model_context_event_blob WHERE event_seq = ?
  `);

  function linkEventBlobs(seq: number, digests: readonly string[]) {
    for (const digest of digests) {
      const normalized = normalizeBlobDigest(digest);
      if (normalized !== undefined) insertEventBlob.run(seq, normalized);
    }
  }

  function readCoverage(): ModelContextCoverage {
    const row = readMeta.get(options.sessionId) as MetaRow | undefined;
    return row && isModelContextCoverage(row.coverage) ? row.coverage : 'assembly-only';
  }

  const meta = readMeta.get(options.sessionId) as MetaRow | undefined;
  if ((meta?.format_version ?? MODEL_CONTEXT_FORMAT_VERSION) < MODEL_CONTEXT_FORMAT_VERSION) {
    const legacyEvents = db
      .prepare(`SELECT seq, payload_json FROM model_context_event ORDER BY seq ASC`)
      .all() as Array<{ seq: number; payload_json: string }>;
    db.exec('BEGIN');
    try {
      for (const event of legacyEvents) {
        const digests = extractLegacyDigests(event.payload_json).filter(
          (digest) => hasBlob.get(digest) !== undefined,
        );
        linkEventBlobs(event.seq, digests);
      }
      updateFormatVersion.run(MODEL_CONTEXT_FORMAT_VERSION, now(), options.sessionId);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Preserve the original database error; a failed rollback is secondary.
      }
      throw error;
    }
  }

  return {
    async putBlob(input) {
      const bytes = typeof input.body === 'string' ? Buffer.from(input.body, 'utf8') : input.body;
      const digest = digestContent(bytes);
      const existed = hasBlob.get(digest) !== undefined;
      if (!existed) {
        insertBlob.run(digest, input.mediaType, bytes.byteLength, bytes, now());
      }
      return { digest, created: !existed, byteLength: bytes.byteLength };
    },
    async appendEvent(input) {
      const eventId = input.eventId ?? randomUUID();
      const createdAt = input.createdAt ?? now();
      db.exec('BEGIN');
      try {
        insertEvent.run(
          eventId,
          input.type,
          input.runId ?? null,
          input.runtimeGenerationId ?? null,
          input.requestClass ?? null,
          input.requestOrdinal ?? null,
          input.idempotencyKey ?? null,
          JSON.stringify(input.payload),
          createdAt,
        );
        const row = lastSeq.get() as { seq: number } | undefined;
        const seq = row?.seq ?? 0;
        if (input.blobDigests !== undefined && seq > 0) {
          linkEventBlobs(seq, input.blobDigests);
        }
        db.exec('COMMIT');
        return { eventId, seq };
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Preserve the original database error; a failed rollback is secondary.
        }
        throw error;
      }
    },
    async recordAssembly(summary) {
      const digests = extractDigestsFromSummary(summary);
      db.exec('BEGIN');
      try {
        insertEvent.run(
          randomUUID(),
          'generation/open',
          summary.runId,
          null,
          summary.requestClass,
          summary.requestOrdinal,
          null,
          JSON.stringify({
            sessionId: summary.sessionId,
            runId: summary.runId,
            requestClass: summary.requestClass,
            requestOrdinal: summary.requestOrdinal,
          }),
          now(),
        );
        insertEvent.run(
          randomUUID(),
          'turn/input',
          summary.runId,
          null,
          summary.requestClass,
          summary.requestOrdinal,
          null,
          JSON.stringify(summary),
          now(),
        );
        const row = lastSeq.get() as { seq: number } | undefined;
        const turnSeq = row?.seq ?? 0;
        if (digests.length > 0 && turnSeq > 0) {
          linkEventBlobs(turnSeq, digests);
        }
        bumpMeta.run(summary.coverage, now(), options.sessionId);
        db.exec('COMMIT');
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Preserve the original database error; a failed rollback is secondary.
        }
        throw error;
      }
    },
    async listSummaries() {
      const rows = listTurnInputs.all() as EventRow[];
      const summaries: ContextSummaryPush[] = [];
      for (const row of rows) {
        try {
          const parsed = JSON.parse(row.payload_json) as ContextSummaryPush;
          if (parsed.type === 'agent/context-summary') {
            summaries.push(parsed);
          }
        } catch {
          continue;
        }
      }
      return summaries;
    },
    async getCoverage() {
      const row = readMeta.get(options.sessionId) as MetaRow | undefined;
      if (row && isModelContextCoverage(row.coverage)) {
        return row.coverage;
      }
      return 'assembly-only';
    },
    async setCoverage(coverage) {
      bumpMeta.run(coverage, now(), options.sessionId);
    },
    async listEvents() {
      const rows = listAllEvents.all() as EventRow[];
      const events: ModelContextCopiedEvent[] = [];
      for (const row of rows) {
        let payload: unknown = {};
        try {
          payload = JSON.parse(row.payload_json) as unknown;
        } catch {
          continue;
        }
        const blobRows = listBlobsForEvent.all(row.seq) as Array<{ blob_digest: string }>;
        const blobDigests = blobRows.map((r) => r.blob_digest);
        const event: ModelContextCopiedEvent = {
          seq: row.seq,
          eventId: row.event_id,
          type: row.type as ModelContextEventType,
          payload,
          createdAt: row.created_at,
        };
        if (row.run_id) event.runId = row.run_id;
        if (row.runtime_generation_id) event.runtimeGenerationId = row.runtime_generation_id;
        if (row.request_class) event.requestClass = row.request_class;
        if (row.request_ordinal !== null) event.requestOrdinal = row.request_ordinal;
        if (row.idempotency_key) event.idempotencyKey = row.idempotency_key;
        if (blobDigests.length > 0) event.blobDigests = blobDigests;
        events.push(event);
      }
      return events;
    },
    async listBlobs() {
      const rows = listAllBlobs.all() as BlobRow[];
      return rows
        .filter((row) => row.digest.startsWith('sha256:'))
        .map((row) => ({
          digest: row.digest as `sha256:${string}`,
          mediaType: row.media_type,
          body: row.body,
        }));
    },
    async pruneUnreferencedBlobs() {
      db.exec('BEGIN IMMEDIATE');
      try {
        const unref = db
          .prepare(
            `SELECT COUNT(*) AS count FROM model_context_blob WHERE digest NOT IN (SELECT DISTINCT blob_digest FROM model_context_event_blob)`,
          )
          .get() as { count: number } | undefined;
        const count = unref?.count ?? 0;
        if (count > 0) {
          db.exec(
            `DELETE FROM model_context_blob WHERE digest NOT IN (SELECT DISTINCT blob_digest FROM model_context_event_blob)`,
          );
        }
        db.exec('COMMIT');
        if (count > 0) db.exec('PRAGMA incremental_vacuum(50);');
        return count;
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Preserve the original database error; a failed rollback is secondary.
        }
        throw error;
      }
    },
    async truncateEventsFrom(seq: number) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const eventCount = (
          db.prepare(`SELECT COUNT(*) as count FROM model_context_event WHERE seq >= ?`).get(seq) as
            | { count: number }
            | undefined
        )?.count ?? 0;
        db.prepare(`DELETE FROM model_context_event WHERE seq >= ?`).run(seq);
        db.prepare(`DELETE FROM model_context_event_blob WHERE event_seq >= ?`).run(seq);
        const removedBlobsCount = (
          db
            .prepare(
              `SELECT COUNT(*) as count FROM model_context_blob WHERE digest NOT IN (SELECT DISTINCT blob_digest FROM model_context_event_blob)`,
            )
            .get() as { count: number } | undefined
        )?.count ?? 0;
        db.exec(
          `DELETE FROM model_context_blob WHERE digest NOT IN (SELECT DISTINCT blob_digest FROM model_context_event_blob)`,
        );
        if (eventCount > 0 || removedBlobsCount > 0) {
          bumpMeta.run(readCoverage(), now(), options.sessionId);
        }
        db.exec('COMMIT');
        db.exec('PRAGMA incremental_vacuum(50);');
        return { removedEvents: eventCount, removedBlobs: removedBlobsCount };
      } catch (error) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Ignore rollback failure
        }
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}
