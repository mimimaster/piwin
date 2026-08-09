/**
 * Bounded-access product transcript store (ADR 0040 §9).
 *
 * One `transcript.sqlite3` database per product session. This is the ONLY
 * module in `@piwin/session` that imports `node:sqlite` — the experimental
 * API stays contained here (same containment rule as @piwin/notes).
 *
 * `id` is the opaque, product-global message id emitted after adapter
 * normalization. `(runtime_generation_id, backend_message_id)` is retained as
 * provenance and the replay-idempotency key; it is never used alone to update
 * a row. User-authored rows use `user-authored` provenance with the client
 * message id; legacy `transcript.json` imports use `legacy-import-v1`.
 *
 * Every read is bounded: tail/history/outline queries return windows, never
 * the complete transcript. Only export/duplicate iterate everything, and they
 * stream in batches.
 */

import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LEGACY_IMPORT_GENERATION,
  SESSION_TRANSCRIPT_PAGE_MAX_BYTES,
  SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MIN_BYTES,
  USER_AUTHORED_GENERATION,
  type MediaAttachmentRef,
  type ModelRef,
  type SessionOutlineNode,
  type SessionOutlinePageData,
  type SessionOutlinePageQuery,
  type SessionTranscriptDocument,
  type SessionTranscriptMessage,
  type SessionTranscriptPageData,
  type SessionTranscriptPageQuery,
  type SessionToolCardView,
} from '@piwin/contracts';
import { projectTranscriptMessagesForUi } from './transcript-ui-projection.js';

export { LEGACY_IMPORT_GENERATION, USER_AUTHORED_GENERATION };

/** Row input for one message append/upsert (normalized id + provenance). */
export type TranscriptStoreMessageInput = {
  /** Opaque normalized product message id (never a naked backend id). */
  id: string;
  /** Runtime generation that produced this row. */
  runtimeGenerationId: string;
  /** Backend message id before normalization (provenance). */
  backendMessageId: string;
  role: SessionTranscriptMessage['role'];
  text: string;
  status: SessionTranscriptMessage['status'];
  createdAt: string;
  thinking?: string;
  runId?: string;
  model?: ModelRef;
  attachments?: MediaAttachmentRef[];
  tools?: SessionToolCardView[];
  metadata?: {
    phaseHistory?: SessionTranscriptMessage['phaseHistory'];
    startedAt?: string;
    endedAt?: string;
    outcome?: SessionTranscriptMessage['outcome'];
    terminalMessage?: string;
    subagentActivity?: SessionTranscriptMessage['subagentActivity'];
  };
};

/** Partial row update keyed by the normalized product id only. */
export type TranscriptStoreMessagePatch = {
  text?: string;
  status?: SessionTranscriptMessage['status'];
  thinking?: string;
  tools?: SessionToolCardView[];
  attachments?: MediaAttachmentRef[];
  metadata?: TranscriptStoreMessageInput['metadata'];
};

export type TranscriptStoreAppendResult =
  { ok: true; replayed?: true } | { ok: false; reason: 'provenance-collision' };

export type TranscriptStoreTruncateResult = {
  found: boolean;
  removedCount: number;
  remainingCount: number;
};

/** A streamed full-transcript read observed a concurrent transcript mutation. */
export class TranscriptIterationStaleError extends Error {
  public readonly name = 'TranscriptIterationStaleError';
}

export type TranscriptStoreOptions = {
  /** Absolute path of the `transcript.sqlite3` file. */
  dbPath: string;
  sessionId: string;
  projectPath: string;
};

export type SessionTranscriptStore = {
  /**
   * Append or replay one message. Same-generation replay with the same
   * backend id is idempotent; a normalized id collision with different
   * provenance is rejected and never mutates the older row.
   */
  appendMessage(input: TranscriptStoreMessageInput): Promise<TranscriptStoreAppendResult>;
  /** Update only the affected row by normalized id. Returns false when absent. */
  updateMessage(id: string, patch: TranscriptStoreMessagePatch): Promise<boolean>;
  /** Read one row by normalized id without scanning the transcript. */
  getMessage(id: string): Promise<SessionTranscriptMessage | undefined>;
  /** Oldest persisted message with the requested role. */
  firstMessageByRole(
    role: SessionTranscriptMessage['role'],
  ): Promise<SessionTranscriptMessage | undefined>;
  /** Newest persisted message with the requested role. */
  lastMessageByRole(
    role: SessionTranscriptMessage['role'],
  ): Promise<SessionTranscriptMessage | undefined>;
  /** Find one bounded user/assistant body match for session search. */
  searchMessage(query: string): Promise<SessionTranscriptMessage | undefined>;
  /** Whether a later assistant row exists (optionally in the same run). */
  hasLaterAssistant(messageId: string, runId?: string): Promise<boolean>;
  /** Delete one row by normalized id. Returns false when absent. */
  deleteMessage(id: string): Promise<boolean>;
  /** Newest-first bounded tail window (chronological order returned). */
  listTail(limit: number, beforeSequence?: number): Promise<SessionTranscriptMessage[]>;
  /** Revision-bound, byte-bounded transcript page for Host clients. */
  transcriptPage(query: SessionTranscriptPageQuery): Promise<SessionTranscriptPageData>;
  /** Number of persisted rows. */
  count(): Promise<number>;
  /** Bounded model-facing history window (role + text only). */
  buildHistoryWindow(options?: {
    maxMessages?: number;
    maxChars?: number;
    excludeMessageId?: string;
  }): Promise<Array<{ role: string; text: string }>>;
  /** Newest assistant model snapshot, if any. */
  recentModel(): Promise<ModelRef | undefined>;
  /** Bounded outline page without loading message bodies. */
  outlinePage(query: SessionOutlinePageQuery): Promise<SessionOutlinePageData>;
  /** Delete from (and including) the row with the given id. */
  truncateFrom(messageId: string): Promise<TranscriptStoreTruncateResult>;
  /** Stream the full transcript in bounded batches (export/duplicate). */
  iterateAll(batchSize?: number): AsyncIterable<SessionTranscriptMessage>;
  /**
   * Transactionally import a legacy `transcript.json` document under the
   * reserved `legacy-import-v1` namespace. Idempotent: a second import of the
   * same digest is a no-op. On any failure the transaction rolls back and the
   * store stays empty/authoritative.
   */
  importLegacyDocument(document: SessionTranscriptDocument): Promise<{ imported: number }>;
  /** Select this initialized Store as the product transcript authority. */
  markAuthoritative(): Promise<void>;
  /** Whether this store is the authority (a verified v2 migration exists). */
  isMigrated(): Promise<boolean>;
  /** Verify count + ids + content digest parity with the legacy document. */
  verifyLegacyDocument(document: SessionTranscriptDocument): Promise<{
    matches: boolean;
    digest: string;
    storedDigest: string | null;
  }>;
  close(): void;
};

const OUTLINE_PREVIEW_CHARS = 120;
const DEFAULT_HISTORY_MESSAGES = 40;
const DEFAULT_HISTORY_CHARS = 24_000;
const MAX_TAIL_MESSAGES = 100;
const MAX_HISTORY_MESSAGES = 200;
const MAX_HISTORY_CHARS = 200_000;
const MAX_ITERATION_BATCH = 1_000;
const OUTLINE_CURSOR_VERSION = 1;
const TRANSCRIPT_CURSOR_VERSION = 1;
const MAX_CURSOR_CHARS = 512;
const CURSOR_ALPHABET = /^[A-Za-z0-9_-]+$/;
const TRUNCATION_MARKER = '\n[message truncated in UI history; full content remains on Host]';

type OutlineCursorPayload = {
  version: number;
  revision: number;
  endSequence: number;
};

type TranscriptCursorPayload = {
  version: number;
  revision: number;
  endSequence: number;
  limit: number;
  maximumBytes: number;
};

type MessageRow = {
  sequence: number;
  id: string;
  runtime_generation_id: string;
  backend_message_id: string;
  role: string;
  text: string;
  thinking: string | null;
  status: string;
  created_at: string;
  run_id: string | null;
  model_json: string | null;
  attachments_json: string | null;
  tools_json: string | null;
  metadata_json: string | null;
};

/** Compute a canonical digest covering every field persisted by the Store. */
export function computeLegacyTranscriptDigest(document: SessionTranscriptDocument): string {
  return digestStoredMessages(
    document.sessionId,
    document.messages.map((message) => legacyMessageToInput(message)),
  );
}

/** Open (creating when absent) the bounded transcript store for one session. */
export async function openSessionTranscriptStore(
  options: TranscriptStoreOptions,
): Promise<SessionTranscriptStore> {
  await mkdir(dirname(options.dbPath), { recursive: true });
  const db = new DatabaseSync(options.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcript_meta(
      session_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      project_path TEXT NOT NULL,
      scope_json TEXT,
      working_directory TEXT,
      updated_at TEXT NOT NULL,
      import_digest TEXT,
      authority_state TEXT NOT NULL DEFAULT 'pending'
    );
    CREATE TABLE IF NOT EXISTS transcript_message(
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      runtime_generation_id TEXT NOT NULL,
      backend_message_id TEXT NOT NULL,
      role TEXT NOT NULL,
      text TEXT NOT NULL,
      thinking TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      run_id TEXT,
      model_json TEXT,
      attachments_json TEXT,
      tools_json TEXT,
      metadata_json TEXT,
      UNIQUE(runtime_generation_id, backend_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_generation
      ON transcript_message(runtime_generation_id, backend_message_id);
    CREATE INDEX IF NOT EXISTS idx_message_sequence
      ON transcript_message(sequence);
  `);
  const metaColumns = db.prepare('PRAGMA table_info(transcript_meta)').all() as Array<{
    name: string;
  }>;
  if (!metaColumns.some((column) => column.name === 'authority_state')) {
    db.exec(
      "ALTER TABLE transcript_meta ADD COLUMN authority_state TEXT NOT NULL DEFAULT 'pending'",
    );
  }
  db.prepare(
    `INSERT OR IGNORE INTO transcript_meta(
      session_id, revision, project_path, updated_at
    ) VALUES (?, 0, ?, ?)`,
  ).run(options.sessionId, options.projectPath, new Date().toISOString());

  let closed = false;

  function ensureOpen(): void {
    if (closed) {
      throw new Error('SessionTranscriptStore is closed');
    }
  }

  function currentRevision(): number {
    const row = db
      .prepare('SELECT revision FROM transcript_meta WHERE session_id = ?')
      .get(options.sessionId) as { revision: number } | undefined;
    return row?.revision ?? 0;
  }

  function bumpRevision(by = 1): void {
    db.prepare(
      `UPDATE transcript_meta SET revision = revision + ?, updated_at = ? WHERE session_id = ?`,
    ).run(by, new Date().toISOString(), options.sessionId);
  }

  function insertMessageRow(input: TranscriptStoreMessageInput): void {
    db.prepare(
      `INSERT INTO transcript_message(
        id, runtime_generation_id, backend_message_id, role, text, thinking,
        status, created_at, run_id, model_json, attachments_json, tools_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.id,
      input.runtimeGenerationId,
      input.backendMessageId,
      input.role,
      input.text,
      input.thinking ?? null,
      input.status,
      input.createdAt,
      input.runId ?? null,
      input.model === undefined ? null : JSON.stringify(input.model),
      input.attachments === undefined ? null : JSON.stringify(input.attachments),
      input.tools === undefined ? null : JSON.stringify(input.tools),
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
    );
  }

  function rowToMessage(row: MessageRow): SessionTranscriptMessage {
    const message: SessionTranscriptMessage = {
      id: row.id,
      role: row.role as SessionTranscriptMessage['role'],
      text: row.text,
      createdAt: row.created_at,
      status: row.status as SessionTranscriptMessage['status'],
      runtimeGenerationId: row.runtime_generation_id,
    };
    if (row.thinking !== null) message.thinking = row.thinking;
    if (row.run_id !== null) message.runId = row.run_id;
    if (row.model_json !== null) message.model = JSON.parse(row.model_json) as ModelRef;
    if (row.attachments_json !== null) {
      message.attachments = JSON.parse(row.attachments_json) as MediaAttachmentRef[];
    }
    if (row.tools_json !== null) {
      message.tools = JSON.parse(row.tools_json) as SessionToolCardView[];
    }
    if (row.metadata_json !== null) {
      const metadata = JSON.parse(row.metadata_json) as NonNullable<
        TranscriptStoreMessageInput['metadata']
      >;
      if (metadata.phaseHistory !== undefined) message.phaseHistory = metadata.phaseHistory;
      if (metadata.startedAt !== undefined) message.startedAt = metadata.startedAt;
      if (metadata.endedAt !== undefined) message.endedAt = metadata.endedAt;
      if (metadata.outcome !== undefined) message.outcome = metadata.outcome;
      if (metadata.terminalMessage !== undefined)
        message.terminalMessage = metadata.terminalMessage;
      if (metadata.subagentActivity !== undefined) {
        message.subagentActivity = metadata.subagentActivity;
      }
    }
    return message;
  }

  function queryTail(limit: number, beforeSequence?: number): SessionTranscriptMessage[] {
    validatePositiveBoundedInteger(limit, 'Transcript tail limit', MAX_TAIL_MESSAGES);
    if (
      beforeSequence !== undefined &&
      (!Number.isSafeInteger(beforeSequence) || beforeSequence <= 0)
    ) {
      throw new RangeError('Transcript tail sequence cursor must be a positive safe integer');
    }
    const rows =
      beforeSequence === undefined
        ? db.prepare(`SELECT * FROM transcript_message ORDER BY sequence DESC LIMIT ?`).all(limit)
        : db
            .prepare(
              `SELECT * FROM transcript_message WHERE sequence < ? ORDER BY sequence DESC LIMIT ?`,
            )
            .all(beforeSequence, limit);
    return (rows as unknown as MessageRow[]).reverse().map(rowToMessage);
  }

  return {
    async appendMessage(input) {
      ensureOpen();
      // Same-generation replay: idempotent no-op.
      const replay = db
        .prepare(
          `SELECT id FROM transcript_message WHERE runtime_generation_id = ? AND backend_message_id = ?`,
        )
        .get(input.runtimeGenerationId, input.backendMessageId) as { id: string } | undefined;
      if (replay !== undefined) {
        return replay.id === input.id
          ? { ok: true, replayed: true }
          : { ok: false, reason: 'provenance-collision' };
      }
      // A normalized id collision with different provenance never mutates
      // the older row.
      const idExists = db.prepare('SELECT 1 FROM transcript_message WHERE id = ?').get(input.id);
      if (idExists !== undefined) {
        return { ok: false, reason: 'provenance-collision' };
      }
      db.exec('BEGIN');
      try {
        insertMessageRow(input);
        bumpRevision();
        db.exec('COMMIT');
        return { ok: true };
      } catch (error) {
        rollback(db);
        if (isSqliteUniqueConstraint(error)) {
          return { ok: false, reason: 'provenance-collision' };
        }
        throw error;
      }
    },

    async updateMessage(id, patch) {
      ensureOpen();
      const assignments: string[] = [];
      const values: Array<string | number | null> = [];
      if (patch.text !== undefined) {
        assignments.push('text = ?');
        values.push(patch.text);
      }
      if (patch.status !== undefined) {
        assignments.push('status = ?');
        values.push(patch.status);
      }
      if (patch.thinking !== undefined) {
        assignments.push('thinking = ?');
        values.push(patch.thinking);
      }
      if (patch.tools !== undefined) {
        assignments.push('tools_json = ?');
        values.push(JSON.stringify(patch.tools));
      }
      if (patch.attachments !== undefined) {
        assignments.push('attachments_json = ?');
        values.push(JSON.stringify(patch.attachments));
      }
      if (patch.metadata !== undefined) {
        assignments.push('metadata_json = ?');
        values.push(JSON.stringify(patch.metadata));
      }
      if (assignments.length === 0) {
        return false;
      }
      db.exec('BEGIN');
      try {
        const result = db
          .prepare(`UPDATE transcript_message SET ${assignments.join(', ')} WHERE id = ?`)
          .run(...values, id);
        if (result.changes > 0) {
          bumpRevision();
        }
        db.exec('COMMIT');
        return result.changes > 0;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async listTail(limit, beforeSequence) {
      ensureOpen();
      return queryTail(limit, beforeSequence);
    },

    async getMessage(id) {
      ensureOpen();
      const row = db.prepare('SELECT * FROM transcript_message WHERE id = ?').get(id) as unknown as
        MessageRow | undefined;
      return row === undefined ? undefined : rowToMessage(row);
    },

    async firstMessageByRole(role) {
      ensureOpen();
      const row = db
        .prepare('SELECT * FROM transcript_message WHERE role = ? ORDER BY sequence ASC LIMIT 1')
        .get(role) as unknown as MessageRow | undefined;
      return row === undefined ? undefined : rowToMessage(row);
    },

    async lastMessageByRole(role) {
      ensureOpen();
      const row = db
        .prepare('SELECT * FROM transcript_message WHERE role = ? ORDER BY sequence DESC LIMIT 1')
        .get(role) as unknown as MessageRow | undefined;
      return row === undefined ? undefined : rowToMessage(row);
    },

    async searchMessage(query) {
      ensureOpen();
      const normalized = query.trim().toLowerCase();
      if (normalized.length === 0 || normalized.length > 1_000) {
        return undefined;
      }
      const row = db
        .prepare(
          `SELECT sequence, id, runtime_generation_id, backend_message_id, role,
                  substr(text, 1, 8000) AS text, thinking, status, created_at,
                  run_id, model_json, attachments_json, tools_json, metadata_json
           FROM transcript_message
           WHERE role IN ('user', 'assistant') AND instr(lower(text), ?) > 0
           ORDER BY CASE role WHEN 'user' THEN 0 ELSE 1 END, sequence DESC
           LIMIT 1`,
        )
        .get(normalized) as unknown as MessageRow | undefined;
      return row === undefined ? undefined : rowToMessage(row);
    },

    async hasLaterAssistant(messageId, runId) {
      ensureOpen();
      const target = db
        .prepare('SELECT sequence FROM transcript_message WHERE id = ?')
        .get(messageId) as { sequence: number } | undefined;
      if (target === undefined) return false;
      const later =
        runId === undefined
          ? db
              .prepare(
                `SELECT 1 FROM transcript_message
               WHERE sequence > ? AND role = 'assistant' LIMIT 1`,
              )
              .get(target.sequence)
          : db
              .prepare(
                `SELECT 1 FROM transcript_message
               WHERE sequence > ? AND role = 'assistant' AND run_id = ? LIMIT 1`,
              )
              .get(target.sequence, runId);
      return later !== undefined;
    },

    async deleteMessage(id) {
      ensureOpen();
      db.exec('BEGIN');
      try {
        const result = db.prepare('DELETE FROM transcript_message WHERE id = ?').run(id);
        if (result.changes > 0) {
          bumpRevision();
        }
        db.exec('COMMIT');
        return result.changes > 0;
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async transcriptPage(query) {
      ensureOpen();
      validateTranscriptPageQuery(query, options.sessionId);
      const revision = currentRevision();
      const totalCount = countRows(db);
      const cursor =
        query.beforeCursor === undefined ? null : decodeTranscriptCursor(query.beforeCursor);
      if (cursor !== null && cursor.revision !== revision) {
        return {
          status: 'stale-cursor',
          currentRevision: revisionToken(options.sessionId, revision),
        };
      }
      if (
        cursor !== null &&
        (cursor.limit !== query.limit || cursor.maximumBytes !== query.maximumBytes)
      ) {
        throw new RangeError('Session transcript cursor limits do not match the query');
      }
      const endSequence = cursor?.endSequence ?? Number.MAX_SAFE_INTEGER;
      const rows = db
        .prepare(
          `SELECT * FROM transcript_message
           WHERE sequence < ? ORDER BY sequence DESC LIMIT ?`,
        )
        .all(endSequence, query.limit) as unknown as MessageRow[];
      const chronologicalRows = rows.reverse();
      const selectedMessages: SessionTranscriptMessage[] = [];
      const selectedSequences: number[] = [];
      const truncatedMessageIds: string[] = [];
      let messageBytes = 2;
      for (let index = chronologicalRows.length - 1; index >= 0; index -= 1) {
        const row = chronologicalRows[index];
        if (row === undefined) {
          continue;
        }
        const source = projectTranscriptMessagesForUi([rowToMessage(row)])[0];
        if (source === undefined) {
          continue;
        }
        const delimiterBytes = selectedMessages.length === 0 ? 0 : 1;
        let projected = source;
        let encodedBytes = serializedMessageBytes(projected);
        if (messageBytes + delimiterBytes + encodedBytes > query.maximumBytes) {
          if (selectedMessages.length > 0) {
            break;
          }
          projected = clipOversizedMessage(source, query.maximumBytes - 2);
          encodedBytes = serializedMessageBytes(projected);
          truncatedMessageIds.push(source.id);
        }
        selectedMessages.unshift(projected);
        selectedSequences.unshift(row.sequence);
        messageBytes += delimiterBytes + encodedBytes;
      }
      const oldestSelectedSequence = selectedSequences[0];
      const hasOlder =
        oldestSelectedSequence !== undefined &&
        db
          .prepare('SELECT 1 FROM transcript_message WHERE sequence < ? LIMIT 1')
          .get(oldestSelectedSequence) !== undefined;
      const endIndex =
        cursor === null ? totalCount : countRowsBeforeSequence(db, cursor.endSequence);
      const startIndex = Math.max(0, endIndex - selectedMessages.length);
      const page = {
        revision: revisionToken(options.sessionId, revision),
        totalCount,
        startIndex,
        endIndex,
        messageBytes,
      };
      const resultPage: typeof page & { truncatedMessageIds?: string[]; olderCursor?: string } =
        page;
      if (truncatedMessageIds.length > 0) {
        resultPage.truncatedMessageIds = truncatedMessageIds;
      }
      if (hasOlder && oldestSelectedSequence !== undefined) {
        resultPage.olderCursor = encodeTranscriptCursor({
          version: TRANSCRIPT_CURSOR_VERSION,
          revision,
          endSequence: oldestSelectedSequence,
          limit: query.limit,
          maximumBytes: query.maximumBytes,
        });
      }
      return { status: 'page', messages: selectedMessages, page: resultPage };
    },

    async count() {
      ensureOpen();
      const row = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
        count: number;
      };
      return row.count;
    },

    async buildHistoryWindow(options = {}) {
      ensureOpen();
      const maxMessages = options.maxMessages ?? DEFAULT_HISTORY_MESSAGES;
      const maxChars = options.maxChars ?? DEFAULT_HISTORY_CHARS;
      validatePositiveBoundedInteger(maxMessages, 'History message limit', MAX_HISTORY_MESSAGES);
      validatePositiveBoundedInteger(maxChars, 'History character limit', MAX_HISTORY_CHARS);
      const excluded =
        options.excludeMessageId === undefined
          ? null
          : (db
              .prepare('SELECT sequence FROM transcript_message WHERE id = ?')
              .get(options.excludeMessageId) as { sequence: number } | undefined);
      const rows =
        excluded === null || excluded === undefined
          ? (db
              .prepare(
                `SELECT role, text FROM transcript_message
               WHERE role IN ('user', 'assistant', 'system') AND text != ''
               ORDER BY sequence DESC LIMIT ?`,
              )
              .all(maxMessages) as Array<{ role: string; text: string }>)
          : (db
              .prepare(
                `SELECT role, text FROM transcript_message
               WHERE sequence < ? AND role IN ('user', 'assistant', 'system') AND text != ''
               ORDER BY sequence DESC LIMIT ?`,
              )
              .all(excluded.sequence, maxMessages) as Array<{ role: string; text: string }>);
      const windowed: Array<{ role: string; text: string }> = [];
      let usedChars = 0;
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        const row = rows[index];
        if (row === undefined) {
          continue;
        }
        const text = row.text.slice(0, 4000);
        if (usedChars + text.length + 1 > maxChars) {
          break;
        }
        windowed.push({ role: row.role, text });
        usedChars += text.length + 1;
      }
      return windowed;
    },

    async recentModel() {
      ensureOpen();
      const row = db
        .prepare(
          `SELECT model_json FROM transcript_message
           WHERE role = 'assistant' AND model_json IS NOT NULL
           ORDER BY sequence DESC LIMIT 1`,
        )
        .get() as { model_json: string } | undefined;
      return row === undefined ? undefined : (JSON.parse(row.model_json) as ModelRef);
    },

    async outlinePage(query) {
      ensureOpen();
      validateOutlineQuery(query, options.sessionId);
      const revision = currentRevision();
      const cursor =
        query.beforeCursor === undefined ? null : decodeOutlineCursor(query.beforeCursor);
      if (cursor !== null && cursor.revision !== revision) {
        // Stale cursor: never mix windows from different revisions.
        return { sessionId: query.sessionId, nodes: [], hasOlder: false, recent: false };
      }
      const endSequence = cursor?.endSequence ?? Number.MAX_SAFE_INTEGER;
      const rows = db
        .prepare(
          `SELECT sequence, id, role, created_at, substr(text, 1, ?) AS preview
           FROM transcript_message
           WHERE sequence < ?
           ORDER BY sequence DESC LIMIT ?`,
        )
        .all(OUTLINE_PREVIEW_CHARS + 1, endSequence, query.limit) as unknown as Array<{
        sequence: number;
        id: string;
        role: string;
        created_at: string;
        preview: string;
      }>;
      const nodes: SessionOutlineNode[] = rows.reverse().map((row) => ({
        id: row.id,
        role: row.role as SessionOutlineNode['role'],
        preview:
          row.preview.length > OUTLINE_PREVIEW_CHARS
            ? `${row.preview.slice(0, OUTLINE_PREVIEW_CHARS - 1)}…`
            : row.preview,
        createdAt: row.created_at,
      }));
      const oldestSequence = rows[0]?.sequence;
      const hasOlder =
        oldestSequence !== undefined &&
        db
          .prepare('SELECT 1 FROM transcript_message WHERE sequence < ? LIMIT 1')
          .get(oldestSequence) !== undefined;
      const data: SessionOutlinePageData = {
        sessionId: query.sessionId,
        nodes,
        hasOlder,
        recent: cursor === null,
      };
      if (hasOlder && oldestSequence !== undefined) {
        data.olderCursor = encodeOutlineCursor({
          version: OUTLINE_CURSOR_VERSION,
          revision,
          endSequence: oldestSequence,
        });
      }
      return data;
    },

    async truncateFrom(messageId) {
      ensureOpen();
      const target = db
        .prepare('SELECT sequence FROM transcript_message WHERE id = ?')
        .get(messageId) as { sequence: number } | undefined;
      if (target === undefined) {
        const remaining = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
          count: number;
        };
        return { found: false, removedCount: 0, remainingCount: remaining.count };
      }
      db.exec('BEGIN');
      try {
        const removed = db
          .prepare('DELETE FROM transcript_message WHERE sequence >= ?')
          .run(target.sequence);
        const removedCount = Number(removed.changes);
        bumpRevision(removedCount);
        db.exec('COMMIT');
        const remaining = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
          count: number;
        };
        return {
          found: true,
          removedCount,
          remainingCount: remaining.count,
        };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async *iterateAll(batchSize = 500) {
      ensureOpen();
      validatePositiveBoundedInteger(batchSize, 'Transcript iteration batch', MAX_ITERATION_BATCH);
      // Full iteration is used to derive durable copies/exports. Keep memory
      // bounded, but fail the operation if streaming writes would otherwise
      // combine rows from different logical transcript revisions.
      const snapshotRevision = currentRevision();
      const assertSnapshotCurrent = (): void => {
        if (currentRevision() !== snapshotRevision) {
          throw new TranscriptIterationStaleError(
            `Transcript changed during streamed iteration for session ${options.sessionId}`,
          );
        }
      };
      let lastSequence = 0;
      for (;;) {
        assertSnapshotCurrent();
        const rows = db
          .prepare(
            `SELECT * FROM transcript_message WHERE sequence > ? ORDER BY sequence ASC LIMIT ?`,
          )
          .all(lastSequence, batchSize) as unknown as MessageRow[];
        if (rows.length === 0) {
          return;
        }
        for (const row of rows) {
          yield rowToMessage(row);
          assertSnapshotCurrent();
          lastSequence = row.sequence;
        }
        if (rows.length < batchSize) {
          return;
        }
      }
    },

    async importLegacyDocument(document) {
      ensureOpen();
      if (document.sessionId !== options.sessionId) {
        throw new Error(
          `Legacy transcript session mismatch: expected ${options.sessionId}, got ${document.sessionId}`,
        );
      }
      const digest = computeLegacyTranscriptDigest(document);
      const meta = db
        .prepare('SELECT import_digest FROM transcript_meta WHERE session_id = ?')
        .get(options.sessionId) as { import_digest: string | null } | undefined;
      if (meta?.import_digest === digest) {
        // Idempotent only while the already-imported database still verifies.
        if (
          digestDatabaseRows(db, options.sessionId) !== digest ||
          countRows(db) !== document.messages.length
        ) {
          throw new Error('Previously imported transcript no longer matches its verified digest');
        }
        return { imported: 0 };
      }
      if (meta?.import_digest !== null && meta?.import_digest !== undefined) {
        // A different legacy document was already imported; never merge.
        return { imported: 0 };
      }
      const hasLiveRows = db
        .prepare(`SELECT 1 FROM transcript_message WHERE runtime_generation_id != ? LIMIT 1`)
        .get(LEGACY_IMPORT_GENERATION);
      if (hasLiveRows !== undefined) {
        // Live rows already exist; do not mix a legacy import underneath.
        return { imported: 0 };
      }
      const hasLegacyRows = db
        .prepare(`SELECT 1 FROM transcript_message WHERE runtime_generation_id = ? LIMIT 1`)
        .get(LEGACY_IMPORT_GENERATION);
      if (hasLegacyRows !== undefined && meta?.import_digest === null) {
        // Interrupted import left legacy rows without a verified digest.
        return { imported: 0 };
      }
      db.exec('BEGIN');
      try {
        let imported = 0;
        for (const message of document.messages) {
          insertMessageRow(legacyMessageToInput(message));
          imported += 1;
        }
        const storedDigest = digestDatabaseRows(db, options.sessionId);
        if (storedDigest !== digest || countRows(db) !== document.messages.length) {
          throw new Error('Legacy transcript verification failed before authority selection');
        }
        db.prepare(
          `UPDATE transcript_meta
           SET import_digest = ?, authority_state = 'v2', updated_at = ?
           WHERE session_id = ?`,
        ).run(storedDigest, new Date().toISOString(), options.sessionId);
        bumpRevision(imported);
        db.exec('COMMIT');
        return { imported };
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    async markAuthoritative() {
      ensureOpen();
      db.prepare(
        `UPDATE transcript_meta SET authority_state = 'v2', updated_at = ? WHERE session_id = ?`,
      ).run(new Date().toISOString(), options.sessionId);
    },

    async isMigrated() {
      ensureOpen();
      const meta = db
        .prepare('SELECT authority_state FROM transcript_meta WHERE session_id = ?')
        .get(options.sessionId) as { authority_state: string } | undefined;
      return meta?.authority_state === 'v2';
    },

    async verifyLegacyDocument(document) {
      ensureOpen();
      const digest = computeLegacyTranscriptDigest(document);
      const meta = db
        .prepare('SELECT import_digest FROM transcript_meta WHERE session_id = ?')
        .get(options.sessionId) as { import_digest: string | null } | undefined;
      const storedDigest = meta?.import_digest ?? null;
      const databaseDigest = digestDatabaseRows(db, options.sessionId);
      return {
        matches:
          storedDigest === digest &&
          databaseDigest === digest &&
          countRows(db) === document.messages.length,
        digest,
        storedDigest,
      };
    },

    close() {
      if (!closed) {
        closed = true;
        db.close();
      }
    },
  };
}

function encodeOutlineCursor(payload: OutlineCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeOutlineCursor(value: string): OutlineCursorPayload {
  if (value.length === 0 || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RangeError('Session outline page cursor encoding is invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new RangeError('Session outline page cursor payload is invalid');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new RangeError('Session outline page cursor must be an object');
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== OUTLINE_CURSOR_VERSION ||
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    typeof record.endSequence !== 'number' ||
    !Number.isSafeInteger(record.endSequence) ||
    record.endSequence <= 0
  ) {
    throw new RangeError('Session outline page cursor fields are invalid');
  }
  return { version: record.version, revision: record.revision, endSequence: record.endSequence };
}

function legacyMessageToInput(message: SessionTranscriptMessage): TranscriptStoreMessageInput {
  const hasMetadata =
    message.phaseHistory !== undefined ||
    message.startedAt !== undefined ||
    message.endedAt !== undefined ||
    message.outcome !== undefined ||
    message.terminalMessage !== undefined ||
    message.subagentActivity !== undefined;
  return {
    id: message.id,
    runtimeGenerationId: LEGACY_IMPORT_GENERATION,
    backendMessageId: message.id,
    role: message.role,
    text: message.text,
    status: message.status,
    createdAt: message.createdAt,
    ...(message.thinking !== undefined ? { thinking: message.thinking } : {}),
    ...(message.runId !== undefined ? { runId: message.runId } : {}),
    ...(message.model !== undefined ? { model: message.model } : {}),
    ...(message.attachments !== undefined ? { attachments: message.attachments } : {}),
    ...(message.tools !== undefined ? { tools: message.tools } : {}),
    ...(hasMetadata
      ? {
          metadata: {
            ...(message.phaseHistory !== undefined ? { phaseHistory: message.phaseHistory } : {}),
            ...(message.startedAt !== undefined ? { startedAt: message.startedAt } : {}),
            ...(message.endedAt !== undefined ? { endedAt: message.endedAt } : {}),
            ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
            ...(message.terminalMessage !== undefined
              ? { terminalMessage: message.terminalMessage }
              : {}),
            ...(message.subagentActivity !== undefined
              ? { subagentActivity: message.subagentActivity }
              : {}),
          },
        }
      : {}),
  };
}

function digestStoredMessages(
  sessionId: string,
  messages: readonly TranscriptStoreMessageInput[],
): string {
  const hash = createHash('sha256');
  hash.update(sessionId);
  hash.update(`\u0000${messages.length}`);
  for (const message of messages) {
    hash.update('\u0000');
    hash.update(stableSerialize(canonicalInput(message)));
  }
  return hash.digest('hex');
}

function digestDatabaseRows(db: DatabaseSync, sessionId: string): string {
  const count = countRows(db);
  const hash = createHash('sha256');
  hash.update(sessionId);
  hash.update(`\u0000${count}`);
  const rows = db
    .prepare('SELECT * FROM transcript_message ORDER BY sequence ASC')
    .iterate() as IterableIterator<unknown>;
  for (const value of rows) {
    const row = value as MessageRow;
    hash.update('\u0000');
    hash.update(stableSerialize(canonicalRow(row)));
  }
  return hash.digest('hex');
}

function canonicalInput(input: TranscriptStoreMessageInput): Record<string, unknown> {
  return {
    id: input.id,
    runtimeGenerationId: input.runtimeGenerationId,
    backendMessageId: input.backendMessageId,
    role: input.role,
    text: input.text,
    thinking: input.thinking ?? null,
    status: input.status,
    createdAt: input.createdAt,
    runId: input.runId ?? null,
    model: input.model ?? null,
    attachments: input.attachments ?? null,
    tools: input.tools ?? null,
    metadata: input.metadata ?? null,
  };
}

function canonicalRow(row: MessageRow): Record<string, unknown> {
  return {
    id: row.id,
    runtimeGenerationId: row.runtime_generation_id,
    backendMessageId: row.backend_message_id,
    role: row.role,
    text: row.text,
    thinking: row.thinking,
    status: row.status,
    createdAt: row.created_at,
    runId: row.run_id,
    model: parseStoredJson(row.model_json),
    attachments: parseStoredJson(row.attachments_json),
    tools: parseStoredJson(row.tools_json),
    metadata: parseStoredJson(row.metadata_json),
  };
}

function parseStoredJson(value: string | null): unknown {
  return value === null ? null : (JSON.parse(value) as unknown);
}

function stableSerialize(value: unknown): string {
  if (value === undefined) {
    return 'null';
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
    .join(',')}}`;
}

function countRows(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
    count: number;
  };
  return row.count;
}

function countRowsBeforeSequence(db: DatabaseSync, sequence: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM transcript_message WHERE sequence < ?')
    .get(sequence) as { count: number };
  return row.count;
}

function validatePositiveBoundedInteger(value: number, label: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${label} must be between 1 and ${maximum}`);
  }
}

function validateOutlineQuery(query: SessionOutlinePageQuery, sessionId: string): void {
  if (query.sessionId !== sessionId) {
    throw new RangeError('Session outline page does not match the opened transcript store');
  }
  validatePositiveBoundedInteger(query.limit, 'Session outline page limit', 100);
  if (query.beforeCursor !== undefined && query.beforeCursor.length > MAX_CURSOR_CHARS) {
    throw new RangeError('Session outline page cursor is too long');
  }
}

function validateTranscriptPageQuery(query: SessionTranscriptPageQuery, sessionId: string): void {
  if (query.sessionId !== sessionId) {
    throw new RangeError('Session transcript page does not match the opened transcript store');
  }
  validatePositiveBoundedInteger(
    query.limit,
    'Session transcript page limit',
    SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  );
  if (
    !Number.isSafeInteger(query.maximumBytes) ||
    query.maximumBytes < SESSION_TRANSCRIPT_PAGE_MIN_BYTES ||
    query.maximumBytes > SESSION_TRANSCRIPT_PAGE_MAX_BYTES
  ) {
    throw new RangeError(
      `Session transcript page byte limit must be between ${SESSION_TRANSCRIPT_PAGE_MIN_BYTES} and ${SESSION_TRANSCRIPT_PAGE_MAX_BYTES}`,
    );
  }
}

function revisionToken(sessionId: string, revision: number): string {
  return createHash('sha256').update(`${sessionId}\u0000${revision}`).digest('hex');
}

function encodeTranscriptCursor(payload: TranscriptCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeTranscriptCursor(value: string): TranscriptCursorPayload {
  if (value.length === 0 || value.length > MAX_CURSOR_CHARS || !CURSOR_ALPHABET.test(value)) {
    throw new RangeError('Session transcript cursor encoding is invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new RangeError('Session transcript cursor payload is invalid');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new RangeError('Session transcript cursor payload must be an object');
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== TRANSCRIPT_CURSOR_VERSION ||
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    typeof record.endSequence !== 'number' ||
    !Number.isSafeInteger(record.endSequence) ||
    record.endSequence <= 0 ||
    typeof record.limit !== 'number' ||
    !Number.isSafeInteger(record.limit) ||
    record.limit <= 0 ||
    record.limit > SESSION_TRANSCRIPT_PAGE_MAX_ITEMS ||
    typeof record.maximumBytes !== 'number' ||
    !Number.isSafeInteger(record.maximumBytes) ||
    record.maximumBytes < SESSION_TRANSCRIPT_PAGE_MIN_BYTES ||
    record.maximumBytes > SESSION_TRANSCRIPT_PAGE_MAX_BYTES
  ) {
    throw new RangeError('Session transcript cursor fields are invalid');
  }
  return {
    version: record.version,
    revision: record.revision,
    endSequence: record.endSequence,
    limit: record.limit,
    maximumBytes: record.maximumBytes,
  };
}

function serializedMessageBytes(message: SessionTranscriptMessage): number {
  return Buffer.byteLength(JSON.stringify(message), 'utf8');
}

function clipOversizedMessage(
  message: SessionTranscriptMessage,
  maximumEncodedBytes: number,
): SessionTranscriptMessage {
  const base: SessionTranscriptMessage = {
    id: message.id,
    role: message.role,
    text: TRUNCATION_MARKER,
    createdAt: message.createdAt,
    status: message.status,
  };
  if (message.runId !== undefined) base.runId = message.runId;
  if (message.startedAt !== undefined) base.startedAt = message.startedAt;
  if (message.endedAt !== undefined) base.endedAt = message.endedAt;
  if (message.outcome !== undefined) base.outcome = message.outcome;
  if (message.model !== undefined) base.model = message.model;
  if (serializedMessageBytes(base) > maximumEncodedBytes) {
    throw new RangeError('Session transcript page byte limit cannot fit message metadata');
  }
  let lowerBound = 0;
  let upperBound = message.text.length;
  while (lowerBound < upperBound) {
    const midpoint = Math.ceil((lowerBound + upperBound) / 2);
    const candidate = {
      ...base,
      text: `${safePrefix(message.text, midpoint)}${TRUNCATION_MARKER}`,
    };
    if (serializedMessageBytes(candidate) <= maximumEncodedBytes) {
      lowerBound = midpoint;
    } else {
      upperBound = midpoint - 1;
    }
  }
  return { ...base, text: `${safePrefix(message.text, lowerBound)}${TRUNCATION_MARKER}` };
}

function safePrefix(value: string, length: number): string {
  if (length <= 0) return '';
  let end = Math.min(length, value.length);
  const trailingCodeUnit = value.charCodeAt(end - 1);
  if (trailingCodeUnit >= 0xd800 && trailingCodeUnit <= 0xdbff) {
    end -= 1;
  }
  return value.slice(0, end);
}

function rollback(db: DatabaseSync): void {
  try {
    db.exec('ROLLBACK');
  } catch {
    // Preserve the original database error; a failed rollback is secondary.
  }
}

function isSqliteUniqueConstraint(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as Record<string, unknown>;
  return (
    record.errcode === 1555 ||
    record.errcode === 2067 ||
    (typeof record.message === 'string' && record.message.includes('UNIQUE constraint failed'))
  );
}
