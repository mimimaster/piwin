/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

import {
  USER_AUTHORED_GENERATION,
  type MediaAttachmentRef,
  type PromptInput,
  QueuedTurnMode,
  QueuedTurnRecord,
  QueuedTurnStatus,
  QueuedTurnTerminalReason,
} from '@piwin/contracts';
import {
  QUEUED_TURN_MAX_PENDING_BYTES_PER_SESSION,
  QUEUED_TURN_MAX_PENDING_PER_SESSION,
  QUEUED_TURN_MAX_TEXT_BYTES,
} from '@piwin/contracts';
import type { TranscriptStoreCore, SessionTranscriptStore } from './transcript-store.js';
import { isSqliteUniqueConstraint, rollback } from './sqlite-errors.js';
import { isIndexedUserMessage } from './transcript-store-bounds.js';
import { stableSerialize } from './stable-serialize.js';
import {
  queuedTurnMetadata,
  rowToQueuedTurn,
  type QueuedTurnRow,
} from './transcript-store-rows.js';

export function createTranscriptQueuedTurnsOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  | 'createQueuedTurn'
  | 'getQueuedTurn'
  | 'listQueuedTurns'
  | 'updatePendingQueuedTurn'
  | 'transitionQueuedTurn'
  | 'reorderQueuedTurns'
  | 'reconcileQueuedTurns'
> {
  const {
    db,
    options,
    ensureOpen,
    bumpRevision,
    bumpQueueRevision,
    currentQueueRevision,
    insertMessageRow,
    attachToActiveLeaf,
  } = core;

  const ops: Pick<
    SessionTranscriptStore,
    | 'createQueuedTurn'
    | 'getQueuedTurn'
    | 'listQueuedTurns'
    | 'updatePendingQueuedTurn'
    | 'transitionQueuedTurn'
    | 'reorderQueuedTurns'
    | 'reconcileQueuedTurns'
  > = {
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
            preserveActiveLeaf: true,
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
          // Pending rows stay off the active path. Splice onto the current
          // leaf only when admission actually starts (or jumps to started).
          if (input.to === 'starting' || (input.to === 'started' && row.status !== 'starting')) {
            attachToActiveLeaf(row.user_message_id);
            // The row was written at submit time, so its sequence sits before
            // the replies the previous run streamed afterwards. Linear pages
            // order by sequence; move it to the tail so the turn it starts
            // follows the reply it waited for.
            db.prepare(
              `UPDATE transcript_message
               SET sequence = (SELECT MAX(sequence) + 1 FROM transcript_message)
               WHERE id = ?
                 AND sequence < (SELECT MAX(sequence) FROM transcript_message)`,
            ).run(row.user_message_id);
          }
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
        const storeApi = ops;
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
      }
  };
  return ops;
}
