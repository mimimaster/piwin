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

import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LEGACY_IMPORT_GENERATION,
  SESSION_TRANSCRIPT_PAGE_MAX_BYTES,
  SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MIN_BYTES,
  SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS,
  SESSION_USER_MESSAGE_PREVIEW_CHARS,
  type SessionTranscriptWindowData,
  type SessionTranscriptWindowInfo,
  type SessionTranscriptWindowQuery,
  type SessionUserMessageIndexData,
  type SessionUserMessageIndexQuery,
  USER_AUTHORED_GENERATION,
  type MediaAttachmentRef,
  type ModelRef,
  type SessionOutlineNode,
  type SessionOutlinePageData,
  type SessionOutlinePageQuery,
  type SessionPauseCheckpoint,
  type SessionPauseCheckpointInput,
  type SessionTranscriptDocument,
  type SessionTranscriptMessage,
  type SessionTranscriptPageData,
  type SessionTranscriptPageQuery,
  type SessionToolCardView,
  type NativeContextEntry,
  type RunInterventionRecord,
  type RunInterventionStatus,
  type RunInterventionTerminalReason,
  type UserInstructionPayload,
  type QueuedTurnMode,
  type QueuedTurnRecord,
  type QueuedTurnStatus,
  type QueuedTurnTerminalReason,
  QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION,
  QUEUED_TURN_MAX_PENDING_PER_SESSION,
  QUEUED_TURN_MAX_TEXT_BYTES,
} from '@piwin/contracts';
import { projectTranscriptMessagesForUi } from './transcript-ui-projection.js';
import {
  createUserMessageIndexData,
  validateUserMessageIndexQuery,
  type UserMessageIndexRow,
} from './user-message-index.js';

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
  contextRefs?: SessionTranscriptMessage['contextRefs'];
  tools?: SessionToolCardView[];
  metadata?: {
    phaseHistory?: SessionTranscriptMessage['phaseHistory'];
    startedAt?: string;
    endedAt?: string;
    thinkingStartedAt?: string;
    thinkingEndedAt?: string;
    outcome?: SessionTranscriptMessage['outcome'];
    terminalMessage?: string;
    subagentActivity?: SessionTranscriptMessage['subagentActivity'];
    searchEvidence?: SessionTranscriptMessage['searchEvidence'];
    instructionDelivery?: SessionTranscriptMessage['instructionDelivery'];
  };
};

export type RunInterventionStoreCreateInput = {
  interventionId: string;
  sessionId: string;
  runId: string;
  runtimeGenerationId: string;
  userMessageId: string;
  input: UserInstructionPayload;
  preparedText: string;
  fingerprint: string;
  submittedAt: string;
};

export type RunInterventionStoreCreateResult =
  | { outcome: 'created' | 'replayed'; intervention: RunInterventionRecord }
  | { outcome: 'idempotency-conflict' | 'message-id-conflict' };

export type RunInterventionStoreTransitionInput = {
  interventionId: string;
  expectedRevision: number;
  from: RunInterventionStatus[];
  to: RunInterventionStatus;
  updatedAt: string;
  terminalReason?: RunInterventionTerminalReason;
  appliedAt?: string;
  appliedRequestOrdinal?: number;
};

export type QueuedTurnStoreCreateInput = {
  queuedTurnId: string;
  sessionId: string;
  userMessageId: string;
  mode: QueuedTurnMode;
  replaceRunId?: string;
  input: import('@piwin/contracts').PromptInput;
  fingerprint: string;
  submittedAt: string;
};

export type QueuedTurnStoreCreateResult =
  | { outcome: 'created' | 'replayed'; queuedTurn: QueuedTurnRecord }
  | {
      outcome: 'idempotency-conflict' | 'message-id-conflict' | 'queue-full' | 'bounds-exceeded';
    };

export type QueuedTurnStoreTransitionInput = {
  queuedTurnId: string;
  expectedRevision: number;
  from: QueuedTurnStatus[];
  to: QueuedTurnStatus;
  updatedAt: string;
  terminalReason?: QueuedTurnTerminalReason;
  startedRunId?: string;
};

/** Partial row update keyed by the normalized product id only. */
export type TranscriptStoreMessagePatch = {
  text?: string;
  status?: SessionTranscriptMessage['status'];
  thinking?: string;
  tools?: SessionToolCardView[];
  attachments?: MediaAttachmentRef[];
  contextRefs?: SessionTranscriptMessage['contextRefs'];
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
  /**
   * Attach opaque native context copies to one message row
   * (spec: session-conversation-tree §4.2). Idempotent per (message, ordinal):
   * replays never overwrite a stored payload.
   */
  appendNativeEntries(
    messageId: string,
    entries: readonly { ordinal: number; entry: NativeContextEntry }[],
  ): Promise<void>;
  /** Native context copies for one message in ordinal order (opaque payloads). */
  readNativeEntries(messageId: string): Promise<NativeContextEntry[]>;
  /** Newest-first bounded tail window (chronological order returned). */
  listTail(limit: number, beforeSequence?: number): Promise<SessionTranscriptMessage[]>;
  /** Revision-bound, byte-bounded transcript page for Host clients. */
  transcriptPage(query: SessionTranscriptPageQuery): Promise<SessionTranscriptPageData>;
  /** Bounded index containing only non-empty user-authored messages. */
  userMessageIndex(query: SessionUserMessageIndexQuery): Promise<SessionUserMessageIndexData>;
  /** Seek to one user-authored message and return a bounded nearby window. */
  transcriptWindow(query: SessionTranscriptWindowQuery): Promise<SessionTranscriptWindowData>;
  /** Number of persisted rows. */
  count(): Promise<number>;
  /** Current monotonic transcript revision used by durable checkpoints. */
  getRevision(): Promise<number>;
  /** Read a checkpoint by id, including consumed/cleared records. */
  getPauseCheckpoint(checkpointId: string): Promise<SessionPauseCheckpoint | undefined>;
  /** Read the one active checkpoint for this session. */
  getActivePauseCheckpoint(): Promise<SessionPauseCheckpoint | undefined>;
  /** Create one active checkpoint; repeated creation by the same Run is idempotent. */
  createPauseCheckpoint(input: SessionPauseCheckpointInput): Promise<SessionPauseCheckpoint>;
  /** Mark an active checkpoint consumed after a resumed Run completes. */
  consumePauseCheckpoint(checkpointId: string): Promise<boolean>;
  /** Mark an active checkpoint cleared by an irreversible Stop or reset. */
  clearPauseCheckpoint(checkpointId?: string): Promise<boolean>;
  /** Atomically store a pending intervention and its provisional user row. */
  createRunIntervention(
    input: RunInterventionStoreCreateInput,
  ): Promise<RunInterventionStoreCreateResult>;
  getRunIntervention(interventionId: string): Promise<RunInterventionRecord | undefined>;
  listRunInterventions(runId: string): Promise<RunInterventionRecord[]>;
  updatePendingRunIntervention(input: {
    interventionId: string;
    expectedRevision: number;
    input: UserInstructionPayload;
    preparedText: string;
    fingerprint: string;
    updatedAt: string;
  }): Promise<RunInterventionRecord | undefined>;
  transitionRunIntervention(
    input: RunInterventionStoreTransitionInput,
  ): Promise<RunInterventionRecord | undefined>;
  /** Atomically store a durable normal next-turn request and its user row. */
  createQueuedTurn(input: QueuedTurnStoreCreateInput): Promise<QueuedTurnStoreCreateResult>;
  getQueuedTurn(queuedTurnId: string): Promise<QueuedTurnRecord | undefined>;
  listQueuedTurns(): Promise<{ queueRevision: number; queuedTurns: QueuedTurnRecord[] }>;
  updatePendingQueuedTurn(input: {
    queuedTurnId: string;
    expectedRevision: number;
    input: import('@piwin/contracts').PromptInput;
    fingerprint: string;
    updatedAt: string;
  }): Promise<QueuedTurnRecord | { outcome: 'queue-full' | 'bounds-exceeded' } | undefined>;
  transitionQueuedTurn(
    input: QueuedTurnStoreTransitionInput,
  ): Promise<QueuedTurnRecord | undefined>;
  reorderQueuedTurns(input: {
    expectedQueueRevision: number;
    orderedQueuedTurnIds: string[];
  }): Promise<{ queueRevision: number; queuedTurns: QueuedTurnRecord[] } | undefined>;
  /** Fail ambiguous in-flight records after a Host restart. */
  reconcileQueuedTurns(updatedAt: string): Promise<QueuedTurnRecord[]>;
  expirePendingRunInterventions(
    runId: string,
    terminalReason: RunInterventionTerminalReason,
    updatedAt: string,
  ): Promise<RunInterventionRecord[]>;
  /** Reconcile crash-orphaned open interventions when no matching Run exists. */
  finalizeOpenRunInterventions(
    terminalReason: RunInterventionTerminalReason,
    updatedAt: string,
  ): Promise<RunInterventionRecord[]>;
  /** Bounded model-facing history window (role + text only). */
  buildHistoryWindow(options?: {
    maxMessages?: number;
    maxChars?: number;
    excludeMessageId?: string;
  }): Promise<
    Array<{
      role: string;
      text: string;
      contextRefs?: SessionTranscriptMessage['contextRefs'];
    }>
  >;
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
  context_refs_json: string | null;
  tools_json: string | null;
  metadata_json: string | null;
};

type PauseCheckpointRow = {
  checkpoint_id: string;
  session_id: string;
  source_run_id: string;
  runtime_generation_id: string | null;
  created_at: string;
  source_user_message_id: string | null;
  last_assistant_message_id: string | null;
  transcript_revision: number;
  status: string;
  consumed_at: string | null;
};

type RunInterventionRow = {
  intervention_id: string;
  revision: number;
  session_id: string;
  run_id: string;
  runtime_generation_id: string;
  sequence: number;
  user_message_id: string;
  status: string;
  input_json: string;
  prepared_text: string;
  fingerprint: string;
  submitted_at: string;
  updated_at: string;
  applied_at: string | null;
  applied_request_ordinal: number | null;
  terminal_reason: string | null;
};

type QueuedTurnRow = {
  queued_turn_id: string;
  revision: number;
  session_id: string;
  sequence: number;
  user_message_id: string;
  mode: string;
  status: string;
  input_json: string;
  fingerprint: string;
  submitted_at: string;
  updated_at: string;
  replace_run_id: string | null;
  started_run_id: string | null;
  terminal_reason: string | null;
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
      user_message_revision INTEGER NOT NULL DEFAULT 0,
      queued_turn_revision INTEGER NOT NULL DEFAULT 0,
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
      context_refs_json TEXT,
      tools_json TEXT,
      metadata_json TEXT,
      UNIQUE(runtime_generation_id, backend_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_generation
      ON transcript_message(runtime_generation_id, backend_message_id);
    CREATE INDEX IF NOT EXISTS idx_message_sequence
      ON transcript_message(sequence);
    CREATE INDEX IF NOT EXISTS idx_message_user_sequence
      ON transcript_message(sequence)
      WHERE role = 'user' AND length(trim(text)) > 0;
    CREATE TABLE IF NOT EXISTS native_entry(
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      payload TEXT NOT NULL,
      byte_length INTEGER NOT NULL,
      truncated INTEGER NOT NULL DEFAULT 0,
      UNIQUE(message_id, ordinal)
    );
    CREATE INDEX IF NOT EXISTS idx_native_entry_message
      ON native_entry(message_id);
    CREATE TABLE IF NOT EXISTS pause_checkpoint(
      checkpoint_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      source_run_id TEXT NOT NULL,
      runtime_generation_id TEXT,
      created_at TEXT NOT NULL,
      source_user_message_id TEXT,
      last_assistant_message_id TEXT,
      transcript_revision INTEGER NOT NULL,
      status TEXT NOT NULL,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pause_checkpoint_session
      ON pause_checkpoint(session_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pause_checkpoint_active_session
      ON pause_checkpoint(session_id) WHERE status = 'active';
    CREATE TABLE IF NOT EXISTS run_intervention(
      intervention_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      runtime_generation_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      user_message_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      prepared_text TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      applied_at TEXT,
      applied_request_ordinal INTEGER,
      terminal_reason TEXT,
      UNIQUE(run_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_run_intervention_run
      ON run_intervention(run_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_run_intervention_status
      ON run_intervention(run_id, status, sequence);
    CREATE TABLE IF NOT EXISTS queued_turn(
      queued_turn_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      user_message_id TEXT NOT NULL UNIQUE,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      submitted_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      replace_run_id TEXT,
      started_run_id TEXT,
      terminal_reason TEXT,
      UNIQUE(session_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_queued_turn_session
      ON queued_turn(session_id, sequence);
    CREATE INDEX IF NOT EXISTS idx_queued_turn_status
      ON queued_turn(session_id, status, sequence);
  `);
  const metaColumns = db.prepare('PRAGMA table_info(transcript_meta)').all() as Array<{
    name: string;
  }>;
  if (!metaColumns.some((column) => column.name === 'authority_state')) {
    db.exec(
      "ALTER TABLE transcript_meta ADD COLUMN authority_state TEXT NOT NULL DEFAULT 'pending'",
    );
  }
  if (!metaColumns.some((column) => column.name === 'user_message_revision')) {
    db.exec(
      'ALTER TABLE transcript_meta ADD COLUMN user_message_revision INTEGER NOT NULL DEFAULT 0',
    );
  }
  if (!metaColumns.some((column) => column.name === 'queued_turn_revision')) {
    db.exec(
      'ALTER TABLE transcript_meta ADD COLUMN queued_turn_revision INTEGER NOT NULL DEFAULT 0',
    );
  }
  const messageColumns = db.prepare('PRAGMA table_info(transcript_message)').all() as Array<{
    name: string;
  }>;
  if (!messageColumns.some((column) => column.name === 'context_refs_json')) {
    db.exec('ALTER TABLE transcript_message ADD COLUMN context_refs_json TEXT');
  }
  db.prepare(
    `INSERT OR IGNORE INTO transcript_meta(
      session_id, revision, project_path, updated_at
    ) VALUES (?, 0, ?, ?)`,
  ).run(options.sessionId, options.projectPath ?? '', new Date().toISOString());

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

  function bumpRevision(by = 1, userMessageBy = 0): void {
    db.prepare(
      `UPDATE transcript_meta
       SET revision = revision + ?,
           user_message_revision = user_message_revision + ?,
           updated_at = ?
       WHERE session_id = ?`,
    ).run(by, userMessageBy, new Date().toISOString(), options.sessionId);
  }

  function currentQueueRevision(): number {
    const row = db
      .prepare('SELECT queued_turn_revision FROM transcript_meta WHERE session_id = ?')
      .get(options.sessionId) as { queued_turn_revision: number } | undefined;
    return row?.queued_turn_revision ?? 0;
  }

  function bumpQueueRevision(userMessageBy = 0): void {
    db.prepare(
      `UPDATE transcript_meta
       SET revision = revision + 1,
           queued_turn_revision = queued_turn_revision + 1,
           user_message_revision = user_message_revision + ?,
           updated_at = ?
       WHERE session_id = ?`,
    ).run(userMessageBy, new Date().toISOString(), options.sessionId);
  }

  function currentUserMessageRevision(): number {
    const row = db
      .prepare('SELECT user_message_revision FROM transcript_meta WHERE session_id = ?')
      .get(options.sessionId) as { user_message_revision: number } | undefined;
    return row?.user_message_revision ?? 0;
  }

  function insertMessageRow(input: TranscriptStoreMessageInput): void {
    db.prepare(
      `INSERT INTO transcript_message(
        id, runtime_generation_id, backend_message_id, role, text, thinking,
        status, created_at, run_id, model_json, attachments_json, context_refs_json,
        tools_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      input.contextRefs === undefined ? null : JSON.stringify(input.contextRefs),
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
    if (row.context_refs_json !== null) {
      const contextRefs = JSON.parse(
        row.context_refs_json,
      ) as SessionTranscriptMessage['contextRefs'];
      if (contextRefs !== undefined) {
        message.contextRefs = contextRefs;
      }
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
      if (metadata.thinkingStartedAt !== undefined) {
        message.thinkingStartedAt = metadata.thinkingStartedAt;
      }
      if (metadata.thinkingEndedAt !== undefined) {
        message.thinkingEndedAt = metadata.thinkingEndedAt;
      }
      if (metadata.outcome !== undefined) message.outcome = metadata.outcome;
      if (metadata.terminalMessage !== undefined)
        message.terminalMessage = metadata.terminalMessage;
      if (metadata.subagentActivity !== undefined) {
        message.subagentActivity = metadata.subagentActivity;
      }
      if (metadata.searchEvidence !== undefined) {
        message.searchEvidence = metadata.searchEvidence;
      }
      if (metadata.instructionDelivery !== undefined) {
        message.instructionDelivery = metadata.instructionDelivery;
      }
    }
    return message;
  }

  function rowToRunIntervention(row: RunInterventionRow): RunInterventionRecord {
    const intervention: RunInterventionRecord = {
      interventionId: row.intervention_id,
      revision: row.revision,
      sessionId: row.session_id,
      runId: row.run_id,
      runtimeGenerationId: row.runtime_generation_id,
      sequence: row.sequence,
      userMessageId: row.user_message_id,
      status: row.status as RunInterventionStatus,
      input: JSON.parse(row.input_json) as UserInstructionPayload,
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
    };
    if (row.applied_at !== null) intervention.appliedAt = row.applied_at;
    if (row.applied_request_ordinal !== null) {
      intervention.appliedRequestOrdinal = row.applied_request_ordinal;
    }
    if (row.terminal_reason !== null) {
      intervention.terminalReason = row.terminal_reason as RunInterventionTerminalReason;
    }
    return intervention;
  }

  function rowToQueuedTurn(row: QueuedTurnRow): QueuedTurnRecord {
    const queuedTurn: QueuedTurnRecord = {
      queuedTurnId: row.queued_turn_id,
      revision: row.revision,
      sessionId: row.session_id,
      sequence: row.sequence,
      userMessageId: row.user_message_id,
      mode: row.mode as QueuedTurnMode,
      status: row.status as QueuedTurnStatus,
      input: JSON.parse(row.input_json) as import('@piwin/contracts').PromptInput,
      submittedAt: row.submitted_at,
      updatedAt: row.updated_at,
    };
    if (row.replace_run_id !== null) queuedTurn.replaceRunId = row.replace_run_id;
    if (row.started_run_id !== null) queuedTurn.startedRunId = row.started_run_id;
    if (row.terminal_reason !== null) {
      queuedTurn.terminalReason = row.terminal_reason as QueuedTurnTerminalReason;
    }
    return queuedTurn;
  }

  function instructionMetadata(
    row: Pick<RunInterventionRecord, 'interventionId' | 'revision' | 'runId' | 'status'>,
  ): NonNullable<TranscriptStoreMessageInput['metadata']> {
    return {
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: row.interventionId,
        status: row.status,
        targetRunId: row.runId,
        revision: row.revision,
      },
    };
  }

  function queuedTurnMetadata(
    row: Pick<QueuedTurnRecord, 'queuedTurnId' | 'revision' | 'status' | 'replaceRunId'> & {
      startedRunId?: string;
    },
  ): NonNullable<TranscriptStoreMessageInput['metadata']> {
    const targetRunId = row.startedRunId ?? row.replaceRunId;
    return {
      instructionDelivery: {
        kind: 'queued-turn',
        instructionId: row.queuedTurnId,
        status: row.status,
        ...(targetRunId === undefined ? {} : { targetRunId }),
        revision: row.revision,
      },
    };
  }

  function rowToPauseCheckpoint(row: PauseCheckpointRow): SessionPauseCheckpoint {
    const checkpoint: SessionPauseCheckpoint = {
      checkpointId: row.checkpoint_id,
      sessionId: row.session_id,
      sourceRunId: row.source_run_id,
      createdAt: row.created_at,
      transcriptRevision: row.transcript_revision,
      status: row.status as SessionPauseCheckpoint['status'],
    };
    if (row.runtime_generation_id !== null) {
      checkpoint.runtimeGenerationId = row.runtime_generation_id;
    }
    if (row.source_user_message_id !== null) {
      checkpoint.sourceUserMessageId = row.source_user_message_id;
    }
    if (row.last_assistant_message_id !== null) {
      checkpoint.lastAssistantMessageId = row.last_assistant_message_id;
    }
    if (row.consumed_at !== null) {
      checkpoint.consumedAt = row.consumed_at;
    }
    return checkpoint;
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

  async function readActivePauseCheckpoint(): Promise<SessionPauseCheckpoint | undefined> {
    ensureOpen();
    const row = db
      .prepare(
        `SELECT * FROM pause_checkpoint
         WHERE session_id = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(options.sessionId) as unknown as PauseCheckpointRow | undefined;
    return row === undefined ? undefined : rowToPauseCheckpoint(row);
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
        bumpRevision(1, isIndexedUserMessage(input.role, input.text) ? 1 : 0);
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
      if (patch.contextRefs !== undefined) {
        assignments.push('context_refs_json = ?');
        values.push(JSON.stringify(patch.contextRefs));
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
        const previous = db
          .prepare('SELECT role, text FROM transcript_message WHERE id = ?')
          .get(id) as { role: string; text: string } | undefined;
        const result = db
          .prepare(`UPDATE transcript_message SET ${assignments.join(', ')} WHERE id = ?`)
          .run(...values, id);
        if (result.changes > 0) {
          const userTextChanged =
            previous !== undefined &&
            patch.text !== undefined &&
            patch.text !== previous.text &&
            isIndexedUserMessage(previous.role, previous.text);
          const userTextBecameIndexed =
            previous !== undefined &&
            patch.text !== undefined &&
            patch.text !== previous.text &&
            previous.role === 'user' &&
            !isIndexedUserMessage(previous.role, previous.text) &&
            isIndexedUserMessage(previous.role, patch.text);
          bumpRevision(1, userTextChanged || userTextBecameIndexed ? 1 : 0);
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
        const previous = db
          .prepare('SELECT role, text FROM transcript_message WHERE id = ?')
          .get(id) as { role: string; text: string } | undefined;
        const result = db.prepare('DELETE FROM transcript_message WHERE id = ?').run(id);
        if (result.changes > 0) {
          db.prepare('DELETE FROM native_entry WHERE message_id = ?').run(id);
          bumpRevision(
            1,
            previous !== undefined && isIndexedUserMessage(previous.role, previous.text) ? 1 : 0,
          );
        }
        db.exec('COMMIT');
        return result.changes > 0;
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async appendNativeEntries(messageId, entries) {
      ensureOpen();
      if (entries.length === 0) {
        return;
      }
      const insert = db.prepare(
        `INSERT OR IGNORE INTO native_entry(message_id, ordinal, payload, byte_length, truncated)
         VALUES (?, ?, ?, ?, ?)`,
      );
      db.exec('BEGIN');
      try {
        for (const { ordinal, entry } of entries) {
          insert.run(
            messageId,
            ordinal,
            entry.payload,
            entry.byteLength,
            entry.truncated === true ? 1 : 0,
          );
        }
        db.exec('COMMIT');
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async readNativeEntries(messageId) {
      ensureOpen();
      const rows = db
        .prepare(
          `SELECT payload, byte_length, truncated FROM native_entry
           WHERE message_id = ? ORDER BY ordinal ASC`,
        )
        .all(messageId) as unknown as Array<{
        payload: string;
        byte_length: number;
        truncated: number;
      }>;
      return rows.map((row) => ({
        format: 'pi-message-v1' as const,
        payload: row.payload,
        byteLength: row.byte_length,
        ...(row.truncated === 1 ? { truncated: true as const } : {}),
      }));
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
        return {
          status: 'stale-cursor',
          currentRevision: revisionToken(options.sessionId, revision),
        };
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

    async userMessageIndex(query) {
      ensureOpen();
      validateUserMessageIndexQuery(query, options.sessionId);
      const totalUserMessages = countIndexedUserMessages(db);
      const rows =
        totalUserMessages <= query.maximumTicks
          ? readExactUserMessageIndexRows(db)
          : readSampledUserMessageIndexRows(db, query.maximumTicks);
      return createUserMessageIndexData({
        sessionId: options.sessionId,
        revision: revisionToken(options.sessionId, currentUserMessageRevision()),
        totalUserMessages,
        maximumTicks: query.maximumTicks,
        rows,
      });
    },

    async transcriptWindow(query) {
      ensureOpen();
      validateTranscriptWindowQuery(query, options.sessionId);
      const anchorRow = db
        .prepare('SELECT * FROM transcript_message WHERE id = ?')
        .get(query.anchorMessageId) as unknown as MessageRow | undefined;
      if (anchorRow === undefined) {
        return { status: 'not-found' };
      }

      const beforeRows = db
        .prepare(
          `SELECT * FROM transcript_message
           WHERE sequence < ? ORDER BY sequence DESC LIMIT ?`,
        )
        .all(anchorRow.sequence, query.beforeItems) as unknown as MessageRow[];
      beforeRows.reverse();
      const afterRows = db
        .prepare(
          `SELECT * FROM transcript_message
           WHERE sequence > ? ORDER BY sequence ASC LIMIT ?`,
        )
        .all(anchorRow.sequence, query.afterItems) as unknown as MessageRow[];
      const entries = [...beforeRows, anchorRow, ...afterRows].map((row) => ({
        sequence: row.sequence,
        message: projectTranscriptMessagesForUi([rowToMessage(row)])[0] ?? rowToMessage(row),
      }));
      const selected = selectTranscriptWindowMessages(
        entries,
        query.anchorMessageId,
        query.maximumBytes,
      );
      const selectedSequences = selected.entries.map((entry) => entry.sequence);
      const firstSequence = selectedSequences[0] ?? anchorRow.sequence;
      const lastSequence = selectedSequences[selectedSequences.length - 1] ?? anchorRow.sequence;
      const totalCount = countRows(db);
      const page: SessionTranscriptWindowInfo = {
        revision: revisionToken(options.sessionId, currentRevision()),
        totalCount,
        startIndex: countRowsBeforeSequence(db, firstSequence),
        endIndex: countRowsBeforeSequence(db, lastSequence) + 1,
        messageBytes: selected.messageBytes,
        anchorMessageId: query.anchorMessageId,
        anchorOffset: selected.anchorOffset,
      };
      if (selected.truncatedMessageIds.length > 0) {
        page.truncatedMessageIds = selected.truncatedMessageIds;
      }
      return { status: 'window', messages: selected.messages, window: page };
    },

    async count() {
      ensureOpen();
      const row = db.prepare('SELECT COUNT(*) AS count FROM transcript_message').get() as {
        count: number;
      };
      return row.count;
    },

    async getRevision() {
      ensureOpen();
      return currentRevision();
    },

    async getPauseCheckpoint(checkpointId) {
      ensureOpen();
      const row = db
        .prepare('SELECT * FROM pause_checkpoint WHERE checkpoint_id = ? AND session_id = ?')
        .get(checkpointId, options.sessionId) as unknown as PauseCheckpointRow | undefined;
      return row === undefined ? undefined : rowToPauseCheckpoint(row);
    },

    async getActivePauseCheckpoint() {
      return readActivePauseCheckpoint();
    },

    async createPauseCheckpoint(input) {
      ensureOpen();
      if (input.sessionId !== options.sessionId) {
        throw new Error(
          `Pause checkpoint session mismatch: expected ${options.sessionId}, got ${input.sessionId}`,
        );
      }
      if (!Number.isSafeInteger(input.transcriptRevision) || input.transcriptRevision < 0) {
        throw new RangeError('Pause checkpoint transcript revision must be a non-negative integer');
      }
      const existing = await readActivePauseCheckpoint();
      if (existing !== undefined) {
        if (existing.sourceRunId === input.sourceRunId) {
          return existing;
        }
        if (input.checkpointId === existing.checkpointId) {
          db.prepare(
            `UPDATE pause_checkpoint
             SET source_run_id = ?, runtime_generation_id = ?, created_at = ?,
                 source_user_message_id = ?, last_assistant_message_id = ?,
                 transcript_revision = ?, status = 'active', consumed_at = NULL
             WHERE checkpoint_id = ? AND session_id = ?`,
          ).run(
            input.sourceRunId,
            input.runtimeGenerationId ?? null,
            input.createdAt,
            input.sourceUserMessageId ?? null,
            input.lastAssistantMessageId ?? null,
            input.transcriptRevision,
            existing.checkpointId,
            options.sessionId,
          );
          return (await readActivePauseCheckpoint()) ?? existing;
        }
        throw new Error(`pause-checkpoint-active: session ${options.sessionId} already has one`);
      }
      const checkpoint: SessionPauseCheckpoint = {
        checkpointId: input.checkpointId ?? randomUUID(),
        sessionId: input.sessionId,
        sourceRunId: input.sourceRunId,
        createdAt: input.createdAt,
        transcriptRevision: input.transcriptRevision,
        status: 'active',
      };
      if (input.runtimeGenerationId !== undefined) {
        checkpoint.runtimeGenerationId = input.runtimeGenerationId;
      }
      if (input.sourceUserMessageId !== undefined) {
        checkpoint.sourceUserMessageId = input.sourceUserMessageId;
      }
      if (input.lastAssistantMessageId !== undefined) {
        checkpoint.lastAssistantMessageId = input.lastAssistantMessageId;
      }
      try {
        db.prepare(
          `INSERT INTO pause_checkpoint(
             checkpoint_id, session_id, source_run_id, runtime_generation_id,
             created_at, source_user_message_id, last_assistant_message_id,
             transcript_revision, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
        ).run(
          checkpoint.checkpointId,
          checkpoint.sessionId,
          checkpoint.sourceRunId,
          checkpoint.runtimeGenerationId ?? null,
          checkpoint.createdAt,
          checkpoint.sourceUserMessageId ?? null,
          checkpoint.lastAssistantMessageId ?? null,
          checkpoint.transcriptRevision,
        );
      } catch (error) {
        if (isSqliteUniqueConstraint(error)) {
          const concurrent = await readActivePauseCheckpoint();
          if (concurrent?.sourceRunId === input.sourceRunId) {
            return concurrent;
          }
        }
        throw error;
      }
      return checkpoint;
    },

    async consumePauseCheckpoint(checkpointId) {
      ensureOpen();
      const result = db
        .prepare(
          `UPDATE pause_checkpoint
           SET status = 'consumed', consumed_at = ?
           WHERE checkpoint_id = ? AND session_id = ? AND status = 'active'`,
        )
        .run(new Date().toISOString(), checkpointId, options.sessionId);
      return result.changes > 0;
    },

    async clearPauseCheckpoint(checkpointId) {
      ensureOpen();
      const result =
        checkpointId === undefined
          ? db
              .prepare(
                `UPDATE pause_checkpoint SET status = 'cleared', consumed_at = ?
                 WHERE session_id = ? AND status = 'active'`,
              )
              .run(new Date().toISOString(), options.sessionId)
          : db
              .prepare(
                `UPDATE pause_checkpoint SET status = 'cleared', consumed_at = ?
                 WHERE checkpoint_id = ? AND session_id = ? AND status = 'active'`,
              )
              .run(new Date().toISOString(), checkpointId, options.sessionId);
      return result.changes > 0;
    },

    async createRunIntervention(input) {
      ensureOpen();
      if (input.sessionId !== options.sessionId) {
        throw new Error(
          `Run intervention session mismatch: expected ${options.sessionId}, got ${input.sessionId}`,
        );
      }
      const existing = db
        .prepare('SELECT * FROM run_intervention WHERE intervention_id = ?')
        .get(input.interventionId) as unknown as RunInterventionRow | undefined;
      if (existing !== undefined) {
        return existing.fingerprint === input.fingerprint &&
          existing.run_id === input.runId &&
          existing.user_message_id === input.userMessageId
          ? { outcome: 'replayed', intervention: rowToRunIntervention(existing) }
          : { outcome: 'idempotency-conflict' };
      }
      if (
        db.prepare('SELECT 1 FROM transcript_message WHERE id = ?').get(input.userMessageId) !==
        undefined
      ) {
        return { outcome: 'message-id-conflict' };
      }
      const sequenceRow = db
        .prepare(
          'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_intervention WHERE run_id = ?',
        )
        .get(input.runId) as { sequence: number };
      const record: RunInterventionRecord = {
        interventionId: input.interventionId,
        revision: 1,
        sessionId: input.sessionId,
        runId: input.runId,
        runtimeGenerationId: input.runtimeGenerationId,
        sequence: sequenceRow.sequence,
        userMessageId: input.userMessageId,
        status: 'pending',
        input: input.input,
        submittedAt: input.submittedAt,
        updatedAt: input.submittedAt,
      };
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(
          `INSERT INTO run_intervention(
             intervention_id, revision, session_id, run_id, runtime_generation_id,
             sequence, user_message_id, status, input_json, prepared_text,
             fingerprint, submitted_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
        ).run(
          record.interventionId,
          record.revision,
          record.sessionId,
          record.runId,
          record.runtimeGenerationId,
          record.sequence,
          record.userMessageId,
          JSON.stringify(record.input),
          input.preparedText,
          input.fingerprint,
          record.submittedAt,
          record.updatedAt,
        );
        insertMessageRow({
          id: record.userMessageId,
          runtimeGenerationId: USER_AUTHORED_GENERATION,
          backendMessageId: record.userMessageId,
          role: 'user',
          text: record.input.text,
          status: 'done',
          createdAt: record.submittedAt,
          runId: record.runId,
          metadata: instructionMetadata(record),
        });
        bumpRevision(1, isIndexedUserMessage('user', record.input.text) ? 1 : 0);
        db.exec('COMMIT');
        return { outcome: 'created', intervention: record };
      } catch (error) {
        rollback(db);
        if (isSqliteUniqueConstraint(error)) {
          const concurrent = db
            .prepare('SELECT * FROM run_intervention WHERE intervention_id = ?')
            .get(input.interventionId) as unknown as RunInterventionRow | undefined;
          if (concurrent !== undefined) {
            return concurrent.fingerprint === input.fingerprint
              ? { outcome: 'replayed', intervention: rowToRunIntervention(concurrent) }
              : { outcome: 'idempotency-conflict' };
          }
          return { outcome: 'message-id-conflict' };
        }
        throw error;
      }
    },

    async getRunIntervention(interventionId) {
      ensureOpen();
      const row = db
        .prepare('SELECT * FROM run_intervention WHERE intervention_id = ? AND session_id = ?')
        .get(interventionId, options.sessionId) as unknown as RunInterventionRow | undefined;
      return row === undefined ? undefined : rowToRunIntervention(row);
    },

    async listRunInterventions(runId) {
      ensureOpen();
      const rows = db
        .prepare(
          'SELECT * FROM run_intervention WHERE session_id = ? AND run_id = ? ORDER BY sequence ASC',
        )
        .all(options.sessionId, runId) as unknown as RunInterventionRow[];
      return rows.map(rowToRunIntervention);
    },

    async updatePendingRunIntervention(input) {
      ensureOpen();
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db
          .prepare(
            `SELECT * FROM run_intervention
             WHERE intervention_id = ? AND session_id = ? AND revision = ? AND status = 'pending'`,
          )
          .get(
            input.interventionId,
            options.sessionId,
            input.expectedRevision,
          ) as unknown as RunInterventionRow | undefined;
        if (row === undefined) {
          db.exec('COMMIT');
          return undefined;
        }
        const revision = row.revision + 1;
        db.prepare(
          `UPDATE run_intervention
           SET revision = ?, input_json = ?, prepared_text = ?, fingerprint = ?, updated_at = ?
           WHERE intervention_id = ?`,
        ).run(
          revision,
          JSON.stringify(input.input),
          input.preparedText,
          input.fingerprint,
          input.updatedAt,
          input.interventionId,
        );
        const updated = rowToRunIntervention({
          ...row,
          revision,
          input_json: JSON.stringify(input.input),
          prepared_text: input.preparedText,
          fingerprint: input.fingerprint,
          updated_at: input.updatedAt,
        });
        db.prepare('UPDATE transcript_message SET text = ?, metadata_json = ? WHERE id = ?').run(
          input.input.text,
          JSON.stringify(instructionMetadata(updated)),
          row.user_message_id,
        );
        bumpRevision(1, 1);
        db.exec('COMMIT');
        return updated;
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async transitionRunIntervention(input) {
      ensureOpen();
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db
          .prepare(
            'SELECT * FROM run_intervention WHERE intervention_id = ? AND session_id = ?',
          )
          .get(input.interventionId, options.sessionId) as unknown as
          | RunInterventionRow
          | undefined;
        if (
          row === undefined ||
          row.revision !== input.expectedRevision ||
          !input.from.includes(row.status as RunInterventionStatus)
        ) {
          db.exec('COMMIT');
          return undefined;
        }
        const revision = row.revision + 1;
        db.prepare(
          `UPDATE run_intervention
           SET revision = ?, status = ?, updated_at = ?, terminal_reason = ?,
               applied_at = ?, applied_request_ordinal = ?
           WHERE intervention_id = ?`,
        ).run(
          revision,
          input.to,
          input.updatedAt,
          input.terminalReason ?? null,
          input.appliedAt ?? null,
          input.appliedRequestOrdinal ?? null,
          input.interventionId,
        );
        const updated = rowToRunIntervention({
          ...row,
          revision,
          status: input.to,
          updated_at: input.updatedAt,
          terminal_reason: input.terminalReason ?? null,
          applied_at: input.appliedAt ?? null,
          applied_request_ordinal: input.appliedRequestOrdinal ?? null,
        });
        db.prepare('UPDATE transcript_message SET metadata_json = ? WHERE id = ?').run(
          JSON.stringify(instructionMetadata(updated)),
          row.user_message_id,
        );
        bumpRevision();
        db.exec('COMMIT');
        return updated;
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async expirePendingRunInterventions(runId, terminalReason, updatedAt) {
      ensureOpen();
      const storeApi = this as SessionTranscriptStore;
      const rows = db
        .prepare(
          `SELECT * FROM run_intervention
           WHERE session_id = ? AND run_id = ? AND status IN ('pending', 'applying')
           ORDER BY sequence ASC`,
        )
        .all(options.sessionId, runId) as unknown as RunInterventionRow[];
      const updated: RunInterventionRecord[] = [];
      for (const row of rows) {
        const result = await storeApi.transitionRunIntervention({
          interventionId: row.intervention_id,
          expectedRevision: row.revision,
          from: [row.status as RunInterventionStatus],
          to: row.status === 'applying' ? 'uncertain' : 'expired',
          updatedAt,
          terminalReason:
            row.status === 'applying' ? 'application-outcome-unknown' : terminalReason,
        });
        if (result !== undefined) updated.push(result);
      }
      return updated;
    },

    async finalizeOpenRunInterventions(terminalReason, updatedAt) {
      ensureOpen();
      const rows = db
        .prepare(
          `SELECT * FROM run_intervention
           WHERE session_id = ? AND status IN ('pending', 'applying')
           ORDER BY run_id ASC, sequence ASC`,
        )
        .all(options.sessionId) as unknown as RunInterventionRow[];
      const updated: RunInterventionRecord[] = [];
      const storeApi = this as SessionTranscriptStore;
      for (const row of rows) {
        const result = await storeApi.transitionRunIntervention({
          interventionId: row.intervention_id,
          expectedRevision: row.revision,
          from: [row.status as RunInterventionStatus],
          to: row.status === 'applying' ? 'uncertain' : 'expired',
          updatedAt,
          terminalReason:
            row.status === 'applying' ? 'application-outcome-unknown' : terminalReason,
        });
        if (result !== undefined) updated.push(result);
      }
      return updated;
    },

    async createQueuedTurn(input) {
      ensureOpen();
      if (input.sessionId !== options.sessionId) {
        throw new Error(
          `Queued turn session mismatch: expected ${options.sessionId}, got ${input.sessionId}`,
        );
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        const existing = db
          .prepare('SELECT * FROM queued_turn WHERE queued_turn_id = ? AND session_id = ?')
          .get(input.queuedTurnId, options.sessionId) as unknown as QueuedTurnRow | undefined;
        if (existing !== undefined) {
          const existingInput = JSON.parse(existing.input_json) as import('@piwin/contracts').PromptInput;
          const same =
            existing.fingerprint === input.fingerprint &&
            existing.user_message_id === input.userMessageId &&
            existing.mode === input.mode &&
            existing.replace_run_id === (input.replaceRunId ?? null);
          db.exec('COMMIT');
          if (!same) return { outcome: 'idempotency-conflict' };
          // Keep this read as a structural check: a caller cannot replay an id
          // with a different JSON payload hidden behind a reused fingerprint.
          if (stableSerialize(existingInput) !== stableSerialize(input.input)) {
            return { outcome: 'idempotency-conflict' };
          }
          return { outcome: 'replayed', queuedTurn: rowToQueuedTurn(existing) };
        }
        if (Buffer.byteLength(input.input.text, 'utf8') > QUEUED_TURN_MAX_TEXT_BYTES) {
          db.exec('COMMIT');
          return { outcome: 'bounds-exceeded' };
        }
        const existingMessage = db
          .prepare('SELECT 1 FROM transcript_message WHERE id = ?')
          .get(input.userMessageId);
        if (existingMessage !== undefined) {
          db.exec('COMMIT');
          return { outcome: 'message-id-conflict' };
        }
        const pending = db
          .prepare(
            `SELECT status, input_json FROM queued_turn
             WHERE session_id = ? AND status IN ('pending', 'starting')`,
          )
          .all(options.sessionId) as Array<{ status: string; input_json: string }>;
        if (pending.length >= QUEUED_TURN_MAX_PENDING_PER_SESSION) {
          db.exec('COMMIT');
          return { outcome: 'queue-full' };
        }
        const pendingBytes = pending.reduce((total, row) => {
          const queuedInput = JSON.parse(row.input_json) as import('@piwin/contracts').PromptInput;
          return total + Buffer.byteLength(queuedInput.text, 'utf8');
        }, 0);
        if (
          pendingBytes + Buffer.byteLength(input.input.text, 'utf8') >
          QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION
        ) {
          db.exec('COMMIT');
          return { outcome: 'queue-full' };
        }
        const sequenceRow = db
          .prepare(
            `SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence
             FROM queued_turn WHERE session_id = ?`,
          )
          .get(options.sessionId) as { sequence: number };
        const record: QueuedTurnRecord = {
          queuedTurnId: input.queuedTurnId,
          revision: 1,
          sessionId: input.sessionId,
          sequence: sequenceRow.sequence,
          userMessageId: input.userMessageId,
          mode: input.mode,
          status: 'pending',
          input: input.input,
          submittedAt: input.submittedAt,
          updatedAt: input.submittedAt,
          ...(input.replaceRunId === undefined ? {} : { replaceRunId: input.replaceRunId }),
        };
        db.prepare(
          `INSERT INTO queued_turn(
             queued_turn_id, revision, session_id, sequence, user_message_id, mode,
             status, input_json, fingerprint, submitted_at, updated_at,
             replace_run_id, started_run_id, terminal_reason
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          record.queuedTurnId,
          record.revision,
          record.sessionId,
          record.sequence,
          record.userMessageId,
          record.mode,
          record.status,
          JSON.stringify(record.input),
          input.fingerprint,
          record.submittedAt,
          record.updatedAt,
          record.replaceRunId ?? null,
          null,
          null,
        );
        const mediaAttachments = input.input.attachments?.filter(
          (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
        );
        insertMessageRow({
          id: record.userMessageId,
          runtimeGenerationId: USER_AUTHORED_GENERATION,
          backendMessageId: record.userMessageId,
          role: 'user',
          text: record.input.text,
          status: 'done',
          createdAt: record.submittedAt,
          ...(mediaAttachments === undefined || mediaAttachments.length === 0
            ? {}
            : { attachments: mediaAttachments }),
          ...(record.input.contextRefs === undefined
            ? {}
            : { contextRefs: record.input.contextRefs }),
          metadata: queuedTurnMetadata(record),
        });
        bumpQueueRevision(isIndexedUserMessage('user', record.input.text) ? 1 : 0);
        db.exec('COMMIT');
        return { outcome: 'created', queuedTurn: record };
      } catch (error) {
        rollback(db);
        if (isSqliteUniqueConstraint(error)) {
          const concurrent = db
            .prepare('SELECT * FROM queued_turn WHERE queued_turn_id = ? AND session_id = ?')
            .get(input.queuedTurnId, options.sessionId) as unknown as QueuedTurnRow | undefined;
          if (concurrent !== undefined && concurrent.fingerprint === input.fingerprint) {
            return { outcome: 'replayed', queuedTurn: rowToQueuedTurn(concurrent) };
          }
          return { outcome: 'message-id-conflict' };
        }
        throw error;
      }
    },

    async getQueuedTurn(queuedTurnId) {
      ensureOpen();
      const row = db
        .prepare('SELECT * FROM queued_turn WHERE queued_turn_id = ? AND session_id = ?')
        .get(queuedTurnId, options.sessionId) as unknown as QueuedTurnRow | undefined;
      return row === undefined ? undefined : rowToQueuedTurn(row);
    },

    async listQueuedTurns() {
      ensureOpen();
      const rows = db
        .prepare(
          `SELECT * FROM queued_turn
           WHERE session_id = ? ORDER BY sequence ASC`,
        )
        .all(options.sessionId) as unknown as QueuedTurnRow[];
      return { queueRevision: currentQueueRevision(), queuedTurns: rows.map(rowToQueuedTurn) };
    },

    async updatePendingQueuedTurn(input) {
      ensureOpen();
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db
          .prepare(
            `SELECT * FROM queued_turn
             WHERE queued_turn_id = ? AND session_id = ? AND revision = ? AND status = 'pending'`,
          )
          .get(input.queuedTurnId, options.sessionId, input.expectedRevision) as unknown as
          | QueuedTurnRow
          | undefined;
        if (row === undefined) {
          db.exec('COMMIT');
          return undefined;
        }
        if (Buffer.byteLength(input.input.text, 'utf8') > QUEUED_TURN_MAX_TEXT_BYTES) {
          db.exec('COMMIT');
          return { outcome: 'bounds-exceeded' };
        }
        const pending = db
          .prepare(
            `SELECT input_json FROM queued_turn
             WHERE session_id = ? AND status IN ('pending', 'starting')
               AND queued_turn_id <> ?`,
          )
          .all(options.sessionId, input.queuedTurnId) as Array<{ input_json: string }>;
        const pendingBytes = pending.reduce((total, pendingRow) => {
          const pendingInput = JSON.parse(pendingRow.input_json) as import('@piwin/contracts').PromptInput;
          return total + Buffer.byteLength(pendingInput.text, 'utf8');
        }, 0);
        if (
          pendingBytes + Buffer.byteLength(input.input.text, 'utf8') >
          QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION
        ) {
          db.exec('COMMIT');
          return { outcome: 'queue-full' };
        }
        const revision = row.revision + 1;
        db.prepare(
          `UPDATE queued_turn
           SET revision = ?, input_json = ?, fingerprint = ?, updated_at = ?
           WHERE queued_turn_id = ? AND session_id = ?`,
        ).run(
          revision,
          JSON.stringify(input.input),
          input.fingerprint,
          input.updatedAt,
          input.queuedTurnId,
          options.sessionId,
        );
        const updated: QueuedTurnRecord = {
          ...rowToQueuedTurn(row),
          revision,
          input: input.input,
          updatedAt: input.updatedAt,
        };
        const mediaAttachments = input.input.attachments?.filter(
          (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
        );
        db.prepare(
          `UPDATE transcript_message
           SET text = ?, attachments_json = ?, context_refs_json = ?, metadata_json = ?
           WHERE id = ?`,
        ).run(
          input.input.text,
          mediaAttachments === undefined || mediaAttachments.length === 0
            ? null
            : JSON.stringify(mediaAttachments),
          input.input.contextRefs === undefined ? null : JSON.stringify(input.input.contextRefs),
          JSON.stringify(queuedTurnMetadata(updated)),
          row.user_message_id,
        );
        bumpQueueRevision();
        db.exec('COMMIT');
        return updated;
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async transitionQueuedTurn(input) {
      ensureOpen();
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db
          .prepare(
            `SELECT * FROM queued_turn
             WHERE queued_turn_id = ? AND session_id = ?`,
          )
          .get(input.queuedTurnId, options.sessionId) as unknown as QueuedTurnRow | undefined;
        if (
          row === undefined ||
          row.revision !== input.expectedRevision ||
          !input.from.includes(row.status as QueuedTurnStatus)
        ) {
          db.exec('COMMIT');
          return undefined;
        }
        const revision = row.revision + 1;
        db.prepare(
          `UPDATE queued_turn
           SET revision = ?, status = ?, updated_at = ?, terminal_reason = ?,
               started_run_id = ?
           WHERE queued_turn_id = ? AND session_id = ?`,
        ).run(
          revision,
          input.to,
          input.updatedAt,
          input.terminalReason ?? null,
          input.startedRunId ?? row.started_run_id,
          input.queuedTurnId,
          options.sessionId,
        );
        const updated: QueuedTurnRecord = {
          ...rowToQueuedTurn(row),
          revision,
          status: input.to,
          updatedAt: input.updatedAt,
          ...(input.startedRunId === undefined
            ? row.started_run_id === null
              ? {}
              : { startedRunId: row.started_run_id }
            : { startedRunId: input.startedRunId }),
          ...(input.terminalReason === undefined
            ? row.terminal_reason === null
              ? {}
              : { terminalReason: row.terminal_reason as QueuedTurnTerminalReason }
            : { terminalReason: input.terminalReason }),
        };
        db.prepare('UPDATE transcript_message SET metadata_json = ?, run_id = ? WHERE id = ?').run(
          JSON.stringify(queuedTurnMetadata(updated)),
          updated.startedRunId ?? null,
          row.user_message_id,
        );
        bumpQueueRevision();
        db.exec('COMMIT');
        return updated;
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async reorderQueuedTurns(input) {
      ensureOpen();
      db.exec('BEGIN IMMEDIATE');
      try {
        const queueRevision = currentQueueRevision();
        if (queueRevision !== input.expectedQueueRevision) {
          db.exec('COMMIT');
          return undefined;
        }
        const rows = db
          .prepare(
            `SELECT * FROM queued_turn
             WHERE session_id = ? AND status = 'pending' ORDER BY sequence ASC`,
          )
          .all(options.sessionId) as unknown as QueuedTurnRow[];
        const currentIds = rows.map((row) => row.queued_turn_id);
        if (
          currentIds.length !== input.orderedQueuedTurnIds.length ||
          new Set(input.orderedQueuedTurnIds).size !== currentIds.length ||
          input.orderedQueuedTurnIds.some((id) => !currentIds.includes(id))
        ) {
          db.exec('COMMIT');
          return undefined;
        }
        db.prepare(
          `UPDATE queued_turn SET sequence = -sequence, revision = revision + 1
           WHERE session_id = ? AND status = 'pending'`,
        ).run(options.sessionId);
        // Terminal rows stay in the durable queue for audit/history purposes.
        // Assign reordered pending rows after the current session maximum so
        // the UNIQUE(session_id, sequence) constraint cannot collide with a
        // previously started/cancelled turn (for example started=1, pending=2).
        const maxSequenceRow = db
          .prepare(
            `SELECT COALESCE(MAX(sequence), 0) AS max_sequence
             FROM queued_turn WHERE session_id = ?`,
          )
          .get(options.sessionId) as { max_sequence: number };
        const firstSequence = maxSequenceRow.max_sequence + 1;
        const updateSequence = db.prepare(
          `UPDATE queued_turn SET sequence = ?
           WHERE queued_turn_id = ? AND session_id = ?`,
        );
        input.orderedQueuedTurnIds.forEach((queuedTurnId, index) => {
          updateSequence.run(firstSequence + index, queuedTurnId, options.sessionId);
        });
        const updatedRows = db
          .prepare(
            `SELECT * FROM queued_turn
             WHERE session_id = ? ORDER BY sequence ASC`,
          )
          .all(options.sessionId) as unknown as QueuedTurnRow[];
        for (const row of updatedRows) {
          db.prepare('UPDATE transcript_message SET metadata_json = ? WHERE id = ?').run(
            JSON.stringify(queuedTurnMetadata(rowToQueuedTurn(row))),
            row.user_message_id,
          );
        }
        bumpQueueRevision();
        db.exec('COMMIT');
        return {
          queueRevision: currentQueueRevision(),
          queuedTurns: updatedRows.map(rowToQueuedTurn),
        };
      } catch (error) {
        rollback(db);
        throw error;
      }
    },

    async reconcileQueuedTurns(updatedAt) {
      ensureOpen();
      const rows = db
        .prepare(
          `SELECT * FROM queued_turn
           WHERE session_id = ? AND (status = 'starting' OR (status = 'pending' AND mode = 'replace'))`,
        )
        .all(options.sessionId) as unknown as QueuedTurnRow[];
      const updated: QueuedTurnRecord[] = [];
      const storeApi = this as SessionTranscriptStore;
      for (const row of rows) {
        const result = await storeApi.transitionQueuedTurn({
          queuedTurnId: row.queued_turn_id,
          expectedRevision: row.revision,
          from: [row.status as QueuedTurnStatus],
          to: 'failed',
          updatedAt,
          terminalReason: 'host-restarted',
        });
        if (result !== undefined) updated.push(result);
      }
      return updated;
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
                `SELECT role, text, context_refs_json FROM transcript_message
               WHERE role IN ('user', 'assistant', 'system') AND text != ''
                 AND (json_extract(metadata_json, '$.instructionDelivery.kind') IS NULL
                      OR (json_extract(metadata_json, '$.instructionDelivery.kind') = 'run-intervention'
                          AND json_extract(metadata_json, '$.instructionDelivery.status') = 'applied')
                      OR (json_extract(metadata_json, '$.instructionDelivery.kind') = 'queued-turn'
                          AND json_extract(metadata_json, '$.instructionDelivery.status') = 'started'))
               ORDER BY sequence DESC LIMIT ?`,
              )
              .all(maxMessages) as Array<{
                role: string;
                text: string;
                context_refs_json: string | null;
              }>)
          : (db
              .prepare(
                `SELECT role, text, context_refs_json FROM transcript_message
               WHERE sequence < ? AND role IN ('user', 'assistant', 'system') AND text != ''
                 AND (json_extract(metadata_json, '$.instructionDelivery.kind') IS NULL
                      OR (json_extract(metadata_json, '$.instructionDelivery.kind') = 'run-intervention'
                          AND json_extract(metadata_json, '$.instructionDelivery.status') = 'applied')
                      OR (json_extract(metadata_json, '$.instructionDelivery.kind') = 'queued-turn'
                          AND json_extract(metadata_json, '$.instructionDelivery.status') = 'started'))
               ORDER BY sequence DESC LIMIT ?`,
              )
              .all(excluded.sequence, maxMessages) as Array<{
                role: string;
                text: string;
                context_refs_json: string | null;
              }>);
      const windowed: Array<{
        role: string;
        text: string;
        contextRefs?: SessionTranscriptMessage['contextRefs'];
      }> = [];
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
        const entry: {
          role: string;
          text: string;
          contextRefs?: SessionTranscriptMessage['contextRefs'];
        } = { role: row.role, text };
        if (row.context_refs_json !== null) {
          entry.contextRefs = JSON.parse(
            row.context_refs_json,
          ) as SessionTranscriptMessage['contextRefs'];
        }
        windowed.push(entry);
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
        const removedUser = db
          .prepare(
            `SELECT COUNT(*) AS count FROM transcript_message
             WHERE sequence >= ? AND role = 'user' AND length(trim(text)) > 0`,
          )
          .get(target.sequence) as { count: number };
        db.prepare(
          `DELETE FROM native_entry WHERE message_id IN (
             SELECT id FROM transcript_message WHERE sequence >= ?
           )`,
        ).run(target.sequence);
        const removed = db
          .prepare('DELETE FROM transcript_message WHERE sequence >= ?')
          .run(target.sequence);
        const removedCount = Number(removed.changes);
        bumpRevision(removedCount, removedUser.count);
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
        let importedUserMessages = 0;
        for (const message of document.messages) {
          insertMessageRow(legacyMessageToInput(message));
          imported += 1;
          if (isIndexedUserMessage(message.role, message.text)) {
            importedUserMessages += 1;
          }
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
        bumpRevision(imported, importedUserMessages);
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
    message.thinkingStartedAt !== undefined ||
    message.thinkingEndedAt !== undefined ||
    message.outcome !== undefined ||
    message.terminalMessage !== undefined ||
    message.subagentActivity !== undefined ||
    message.searchEvidence !== undefined;
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
    ...(message.contextRefs !== undefined ? { contextRefs: message.contextRefs } : {}),
    ...(message.tools !== undefined ? { tools: message.tools } : {}),
    ...(hasMetadata
      ? {
          metadata: {
            ...(message.phaseHistory !== undefined ? { phaseHistory: message.phaseHistory } : {}),
            ...(message.startedAt !== undefined ? { startedAt: message.startedAt } : {}),
            ...(message.endedAt !== undefined ? { endedAt: message.endedAt } : {}),
            ...(message.thinkingStartedAt !== undefined
              ? { thinkingStartedAt: message.thinkingStartedAt }
              : {}),
            ...(message.thinkingEndedAt !== undefined
              ? { thinkingEndedAt: message.thinkingEndedAt }
              : {}),
            ...(message.outcome !== undefined ? { outcome: message.outcome } : {}),
            ...(message.terminalMessage !== undefined
              ? { terminalMessage: message.terminalMessage }
              : {}),
            ...(message.subagentActivity !== undefined
              ? { subagentActivity: message.subagentActivity }
              : {}),
            ...(message.searchEvidence !== undefined
              ? { searchEvidence: message.searchEvidence }
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
  const canonical: Record<string, unknown> = {
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
  // Omit absent contextRefs so legacy import digests stay stable.
  if (input.contextRefs !== undefined) {
    canonical.contextRefs = input.contextRefs;
  }
  return canonical;
}

function canonicalRow(row: MessageRow): Record<string, unknown> {
  const canonical: Record<string, unknown> = {
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
  // Null storage means the field was never written; omit for digest parity.
  if (row.context_refs_json !== null) {
    canonical.contextRefs = parseStoredJson(row.context_refs_json);
  }
  return canonical;
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

function countIndexedUserMessages(db: DatabaseSync): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM transcript_message
       WHERE role = 'user' AND length(trim(text)) > 0`,
    )
    .get() as { count: number };
  return row.count;
}

function isIndexedUserMessage(role: string, text: string): boolean {
  return role === 'user' && text.trim().length > 0;
}

function readExactUserMessageIndexRows(db: DatabaseSync): UserMessageIndexRow[] {
  const rows = db
    .prepare(
      `SELECT id, created_at, substr(text, 1, ?) AS preview,
              ROW_NUMBER() OVER (ORDER BY sequence) - 1 AS ordinal
       FROM transcript_message
       WHERE role = 'user' AND length(trim(text)) > 0
       ORDER BY sequence ASC`,
    )
    .all(SESSION_USER_MESSAGE_PREVIEW_CHARS + 1) as unknown as Array<{
    id: string;
    created_at: string;
    preview: string;
    ordinal: number;
  }>;
  return rows.map((row) => ({
    messageId: row.id,
    createdAt: row.created_at,
    ordinal: row.ordinal,
    spanStartOrdinal: row.ordinal,
    spanEndOrdinal: row.ordinal,
    preview: row.preview,
  }));
}

function readSampledUserMessageIndexRows(
  db: DatabaseSync,
  maximumTicks: number,
): UserMessageIndexRow[] {
  const rows = db
    .prepare(
      `WITH user_rows AS (
         SELECT sequence, id,
                ROW_NUMBER() OVER (ORDER BY sequence) - 1 AS ordinal,
                COUNT(*) OVER () AS total
         FROM transcript_message
         WHERE role = 'user' AND length(trim(text)) > 0
       ), bucketed AS (
         SELECT *, CAST(ordinal * ? / total AS INTEGER) AS bucket
         FROM user_rows
       ), representatives AS (
         SELECT bucket, MIN(ordinal) AS span_start_ordinal,
                MAX(ordinal) AS span_end_ordinal,
                MIN(ordinal) AS representative_ordinal
         FROM bucketed
         GROUP BY bucket
         ORDER BY bucket
         LIMIT ?
       )
       SELECT source.id, message.created_at,
              substr(message.text, 1, ?) AS preview,
              source.ordinal,
              representatives.span_start_ordinal,
              representatives.span_end_ordinal
       FROM representatives
       JOIN bucketed AS source
         ON source.ordinal = representatives.representative_ordinal
       JOIN transcript_message AS message
         ON message.sequence = source.sequence
       ORDER BY source.ordinal ASC`,
    )
    .all(maximumTicks, maximumTicks, SESSION_USER_MESSAGE_PREVIEW_CHARS + 1) as unknown as Array<{
    id: string;
    created_at: string;
    preview: string;
    ordinal: number;
    span_start_ordinal: number;
    span_end_ordinal: number;
  }>;
  return rows.map((row) => ({
    messageId: row.id,
    createdAt: row.created_at,
    ordinal: row.ordinal,
    spanStartOrdinal: row.span_start_ordinal,
    spanEndOrdinal: row.span_end_ordinal,
    preview: row.preview,
  }));
}

type TranscriptWindowEntry = {
  sequence: number;
  message: SessionTranscriptMessage;
};

function selectTranscriptWindowMessages(
  entries: readonly TranscriptWindowEntry[],
  anchorMessageId: string,
  maximumBytes: number,
): {
  entries: TranscriptWindowEntry[];
  messages: SessionTranscriptMessage[];
  messageBytes: number;
  anchorOffset: number;
  truncatedMessageIds: string[];
} {
  const anchorIndex = entries.findIndex((entry) => entry.message.id === anchorMessageId);
  const anchor = entries[anchorIndex];
  if (anchor === undefined) {
    return { entries: [], messages: [], messageBytes: 2, anchorOffset: 0, truncatedMessageIds: [] };
  }

  const selected = new Map<string, TranscriptWindowEntry>();
  const truncatedMessageIds: string[] = [];
  let messageBytes = 2;
  const add = (entry: TranscriptWindowEntry, force = false): void => {
    if (selected.has(entry.message.id)) return;
    const delimiterBytes = selected.size === 0 ? 0 : 1;
    let candidate = entry.message;
    let encodedBytes = serializedMessageBytes(candidate);
    if (messageBytes + delimiterBytes + encodedBytes > maximumBytes) {
      if (!force && selected.size > 0) return;
      candidate = clipOversizedMessage(entry.message, maximumBytes - 2);
      encodedBytes = serializedMessageBytes(candidate);
      truncatedMessageIds.push(entry.message.id);
    }
    selected.set(entry.message.id, { ...entry, message: candidate });
    messageBytes += delimiterBytes + encodedBytes;
  };

  add(anchor, true);
  for (let index = anchorIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry) add(entry);
  }
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry) add(entry);
  }
  const selectedEntries = [...selected.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  return {
    entries: selectedEntries,
    messages: selectedEntries.map((entry) => entry.message),
    messageBytes,
    anchorOffset: Math.max(
      0,
      selectedEntries.findIndex((entry) => entry.message.id === anchorMessageId),
    ),
    truncatedMessageIds,
  };
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

function validateTranscriptWindowQuery(
  query: SessionTranscriptWindowQuery,
  sessionId: string,
): void {
  if (query.sessionId !== sessionId) {
    throw new RangeError('Transcript window session does not match the opened transcript store');
  }
  if (query.anchorMessageId.trim().length === 0 || query.anchorMessageId.length > 256) {
    throw new RangeError('Transcript window anchor message id is invalid');
  }
  if (
    !Number.isSafeInteger(query.beforeItems) ||
    query.beforeItems < 0 ||
    !Number.isSafeInteger(query.afterItems) ||
    query.afterItems < 0 ||
    query.beforeItems + query.afterItems + 1 > SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS
  ) {
    throw new RangeError('Transcript window item limits are invalid');
  }
  if (
    !Number.isSafeInteger(query.maximumBytes) ||
    query.maximumBytes < SESSION_TRANSCRIPT_PAGE_MIN_BYTES ||
    query.maximumBytes > SESSION_TRANSCRIPT_PAGE_MAX_BYTES
  ) {
    throw new RangeError('Transcript window byte limit is invalid');
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
  if (message.searchEvidence !== undefined) base.searchEvidence = message.searchEvidence;
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
