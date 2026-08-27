/**
 * Bounded-access product transcript store (ADR 0040 §9) — composition root.
 *
 * One `transcript.sqlite3` database per product session. This is the ONLY
 * module in `@piwin/session` with a runtime import of `node:sqlite` — the
 * experimental API stays contained in this module family (the split domain
 * modules under `transcript-store-*.ts` use type-only imports).
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

import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  LEGACY_IMPORT_GENERATION,
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
  type SessionRunOutcome,
  type UserInstructionPayload,
  type QueuedTurnMode,
  type QueuedTurnRecord,
  type QueuedTurnStatus,
  type QueuedTurnTerminalReason,
} from '@piwin/contracts';
import {
  createTranscriptBranchesOps,
  type TranscriptBranchPoint,
} from './transcript-store-branches.js';
import { createTranscriptHistoryOps } from './transcript-store-history.js';
import { createTranscriptInterventionsOps } from './transcript-store-interventions.js';
import { createTranscriptLegacyOps } from './transcript-store-legacy.js';
import { createTranscriptMessagesOps } from './transcript-store-messages.js';
import { createTranscriptPagesOps } from './transcript-store-pages.js';
import { createTranscriptPauseOps } from './transcript-store-pause.js';
import { createTranscriptQueuedTurnsOps } from './transcript-store-queued-turns.js';
import { createTranscriptStreamSettleOps } from './transcript-store-stream-settle.js';
export { LEGACY_IMPORT_GENERATION, USER_AUTHORED_GENERATION };
export type { SettleStreamingMessagesInput } from './transcript-store-stream-settle.js';
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
    docCardSequence?: SessionTranscriptMessage['docCardSequence'];
    replyWriter?: SessionTranscriptMessage['replyWriter'];
    workspaceWrites?: SessionTranscriptMessage['workspaceWrites'];
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

export type QueuedTurnConversionInput = {
  queuedTurnId: string;
  /** CAS on the queued turn revision; a concurrent drain wins the race. */
  expectedRevision: number;
  interventionId: string;
  runId: string;
  runtimeGenerationId: string;
  userMessageId: string;
  input: UserInstructionPayload;
  preparedText: string;
  fingerprint: string;
  updatedAt: string;
};

export type QueuedTurnConversionResult =
  | { outcome: 'converted' | 'replayed'; queuedTurn: QueuedTurnRecord; intervention: RunInterventionRecord }
  | {
      outcome:
        | 'queued-turn-not-found'
        | 'queued-turn-not-pending'
        | 'queued-turn-revision-conflict'
        | 'idempotency-conflict';
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
  /**
   * Close crash/abort leftovers: assistant rows still `streaming`.
   * Idempotent when none match. Does not rewrite message bodies.
   */
  settleStreamingMessages(input: {
    runId?: string;
    updatedAt: string;
    outcome: SessionRunOutcome;
    terminalMessage?: string;
  }): Promise<SessionTranscriptMessage[]>;
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
  /**
   * Atomically convert a pending queued turn into a Run intervention bound
   * to one exact Run. The queued turn is cancelled, the intervention row is
   * created, and the existing user row is re-bound — all in one transaction,
   * so a crash can never lose the message or admit it twice.
   */
  convertQueuedTurnToIntervention(
    input: QueuedTurnConversionInput,
  ): Promise<QueuedTurnConversionResult>;
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
  /** Active leaf id of the conversation tree (null in an empty store). */
  getActiveLeaf(): Promise<string | null>;
  /**
   * Parent id of one row: null for roots, undefined when the row is absent.
   * Host-side branch prompts resolve the rebase target with this — clients
   * never see parent ids (`SessionTranscriptMessage` carries none).
   */
  getParentMessageId(messageId: string): Promise<string | null | undefined>;
  /**
   * Move the leaf exactly to `messageId` (null = start a new root). Used by
   * branch prompts: the next append becomes a sibling of the abandoned turn.
   */
  rebaseActiveLeaf(messageId: string | null): Promise<void>;
  /** Move the leaf to the deepest node of the target's subtree. */
  switchActiveBranch(targetMessageId: string): Promise<{ activeLeafMessageId: string }>;
  /**
   * Assistant rows a switch to `targetMessageId` would leave behind: the
   * active path after its fork with the target. Empty when the target is
   * already on the path, `undefined` when the target does not exist (the
   * caller lets `switchActiveBranch` raise the real error). Feeds the
   * write-boundary check (ADR 0055) without loading the whole path.
   */
  listAbandonedAssistantRows(
    targetMessageId: string,
  ): Promise<SessionTranscriptMessage[] | undefined>;
  /** ‹n/m› switcher data: one point per fork along the active path. */
  listBranchPoints(options: { previewChars: number }): Promise<TranscriptBranchPoint[]>;
  /**
   * Delete the message and its entire subtree (explicit destructive gesture,
   * ADR 0055). When the subtree contains the active path, the leaf falls back
   * to the target's parent.
   */
  truncateFrom(messageId: string): Promise<TranscriptStoreTruncateResult>;
  /**
   * Stream the active path in bounded batches (export/duplicate/fork). Never
   * the whole tree: abandoned branches stay private to this store (ADR 0055).
   */
  iterateActivePath(batchSize?: number): AsyncIterable<SessionTranscriptMessage>;
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

export { TranscriptIterationStaleError } from './transcript-store-history.js';
export { computeLegacyTranscriptDigest } from './transcript-store-legacy.js';

/**
 * Shared closures every domain module receives. Defined here so the split
 * modules stay runtime-leaf (type-only imports back into this file).
 */
export type TranscriptStoreCore = {
  db: DatabaseSync;
  options: TranscriptStoreOptions;
  ensureOpen(): void;
  currentRevision(): number;
  bumpRevision(by?: number, userMessageBy?: number): void;
  currentQueueRevision(): number;
  bumpQueueRevision(userMessageBy?: number): void;
  currentUserMessageRevision(): number;
  insertMessageRow(input: TranscriptStoreMessageInput): void;
};

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
      authority_state TEXT NOT NULL DEFAULT 'pending',
      active_leaf_message_id TEXT
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
      parent_message_id TEXT,
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
  // Conversation tree v3 (ADR 0055): every row points at its parent and the
  // meta row tracks the active leaf. Pre-tree databases get the columns lazily.
  const parentColumnAdded = !messageColumns.some(
    (column) => column.name === 'parent_message_id',
  );
  if (parentColumnAdded) {
    db.exec('ALTER TABLE transcript_message ADD COLUMN parent_message_id TEXT');
  }
  if (!metaColumns.some((column) => column.name === 'active_leaf_message_id')) {
    db.exec('ALTER TABLE transcript_meta ADD COLUMN active_leaf_message_id TEXT');
  }
  // Created here (not in the main batch) so an old database gains the column
  // via ALTER before the index references it.
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_message_parent ON transcript_message(parent_message_id)',
  );
  if (parentColumnAdded) {
    // One-time chain backfill: linear history becomes a single path. Runs only
    // when the column was just added — NULL parents on an already-migrated
    // database are genuine additional roots and must never be rewritten.
    db.exec('BEGIN');
    try {
      db.exec(
        `UPDATE transcript_message SET parent_message_id =
           (SELECT t2.id FROM transcript_message t2
            WHERE t2.sequence < transcript_message.sequence
            ORDER BY t2.sequence DESC LIMIT 1)`,
      );
      db.prepare(
        `UPDATE transcript_meta SET active_leaf_message_id =
           (SELECT id FROM transcript_message ORDER BY sequence DESC LIMIT 1)
         WHERE session_id = ?`,
      ).run(options.sessionId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
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
    // Tree chaining happens here — the single choke point every insert path
    // (append, queued turn, intervention, legacy import) already goes through.
    // Provenance replays early-return in appendMessage and never reach this,
    // so a replay can never move the leaf. Callers hold the transaction.
    const leafRow = db
      .prepare('SELECT active_leaf_message_id FROM transcript_meta WHERE session_id = ?')
      .get(options.sessionId) as { active_leaf_message_id: string | null } | undefined;
    db.prepare(
      `INSERT INTO transcript_message(
        id, runtime_generation_id, backend_message_id, role, text, thinking,
        status, created_at, run_id, model_json, attachments_json, context_refs_json,
        tools_json, metadata_json, parent_message_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      leafRow?.active_leaf_message_id ?? null,
    );
    db.prepare(
      'UPDATE transcript_meta SET active_leaf_message_id = ? WHERE session_id = ?',
    ).run(input.id, options.sessionId);
  }
  const core: TranscriptStoreCore = {
    db,
    options,
    ensureOpen,
    currentRevision,
    bumpRevision,
    currentQueueRevision,
    bumpQueueRevision,
    currentUserMessageRevision,
    insertMessageRow,
  };

  return {
    ...createTranscriptMessagesOps(core),
    ...createTranscriptStreamSettleOps(core),
    ...createTranscriptBranchesOps(core),
    ...createTranscriptPagesOps(core),
    ...createTranscriptPauseOps(core),
    ...createTranscriptInterventionsOps(core),
    ...createTranscriptQueuedTurnsOps(core),
    ...createTranscriptHistoryOps(core),
    ...createTranscriptLegacyOps(core),
      close() {
        if (!closed) {
          closed = true;
          db.close();
        }
      },
  };
}
