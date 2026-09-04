/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

import {
  USER_AUTHORED_GENERATION,
  type MediaAttachmentRef,
  type RunInterventionRecord,
  RunInterventionStatus,
  RunInterventionTerminalReason,
  UserInstructionPayload,
} from '@piwin/contracts';
import type { TranscriptStoreCore, SessionTranscriptStore } from './transcript-store.js';
import { isSqliteUniqueConstraint, rollback } from './sqlite-errors.js';
import { isIndexedUserMessage } from './transcript-store-bounds.js';
import {
  instructionMetadata,
  rowToQueuedTurn,
  rowToRunIntervention,
  type QueuedTurnRow,
  type RunInterventionRow,
} from './transcript-store-rows.js';

export function createTranscriptInterventionsOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  | 'createRunIntervention'
  | 'getRunIntervention'
  | 'listRunInterventions'
  | 'updatePendingRunIntervention'
  | 'transitionRunIntervention'
  | 'convertQueuedTurnToIntervention'
  | 'expirePendingRunInterventions'
  | 'finalizeOpenRunInterventions'
> {
  const { db, options, ensureOpen, bumpRevision, bumpQueueRevision, insertMessageRow } = core;

  const ops: Pick<
    SessionTranscriptStore,
    | 'createRunIntervention'
    | 'getRunIntervention'
    | 'listRunInterventions'
    | 'updatePendingRunIntervention'
    | 'transitionRunIntervention'
    | 'convertQueuedTurnToIntervention'
    | 'expirePendingRunInterventions'
    | 'finalizeOpenRunInterventions'
  > = {
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
            ...instructionTranscriptExtras(record.input),
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
          const extras = instructionTranscriptExtras(input.input);
          db.prepare(
            `UPDATE transcript_message
             SET text = ?, attachments_json = ?, context_refs_json = ?, metadata_json = ?
             WHERE id = ?`,
          ).run(
            input.input.text,
            extras.attachments === undefined ? null : JSON.stringify(extras.attachments),
            extras.contextRefs === undefined ? null : JSON.stringify(extras.contextRefs),
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

      async convertQueuedTurnToIntervention(input) {
        ensureOpen();
        if (input.userMessageId.trim().length === 0) {
          throw new Error('Queued turn conversion requires a user message id');
        }
        db.exec('BEGIN IMMEDIATE');
        try {
          const interventionRow = db
            .prepare('SELECT * FROM run_intervention WHERE intervention_id = ?')
            .get(input.interventionId) as unknown as RunInterventionRow | undefined;
          const queuedRow = db
            .prepare('SELECT * FROM queued_turn WHERE queued_turn_id = ? AND session_id = ?')
            .get(input.queuedTurnId, options.sessionId) as unknown as QueuedTurnRow | undefined;
          if (interventionRow !== undefined) {
            // Idempotent ACK-timeout replay: the conversion is atomic, so an
            // existing intervention with this identity must already own a
            // cancelled queued turn. Anything else is a conflicting identity.
            const replayed =
              interventionRow.fingerprint === input.fingerprint &&
              interventionRow.run_id === input.runId &&
              interventionRow.user_message_id === input.userMessageId &&
              queuedRow !== undefined &&
              queuedRow.status === 'cancelled' &&
              queuedRow.terminal_reason === 'converted-to-intervention';
            db.exec('COMMIT');
            return replayed
              ? {
                  outcome: 'replayed',
                  queuedTurn: rowToQueuedTurn(queuedRow),
                  intervention: rowToRunIntervention(interventionRow),
                }
              : { outcome: 'idempotency-conflict' };
          }
          if (queuedRow === undefined) {
            db.exec('COMMIT');
            return { outcome: 'queued-turn-not-found' };
          }
          if (queuedRow.user_message_id !== input.userMessageId) {
            db.exec('COMMIT');
            return { outcome: 'idempotency-conflict' };
          }
          if (queuedRow.status !== 'pending') {
            db.exec('COMMIT');
            return { outcome: 'queued-turn-not-pending' };
          }
          if (queuedRow.revision !== input.expectedRevision) {
            db.exec('COMMIT');
            return { outcome: 'queued-turn-revision-conflict' };
          }
          const intervention: RunInterventionRecord = {
            interventionId: input.interventionId,
            revision: 1,
            sessionId: options.sessionId,
            runId: input.runId,
            runtimeGenerationId: input.runtimeGenerationId,
            sequence:
              (
                db
                  .prepare(
                    'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM run_intervention WHERE run_id = ?',
                  )
                  .get(input.runId) as { sequence: number }
              ).sequence,
            userMessageId: input.userMessageId,
            status: 'pending',
            input: input.input,
            submittedAt: input.updatedAt,
            updatedAt: input.updatedAt,
          };
          db.prepare(
            `INSERT INTO run_intervention(
               intervention_id, revision, session_id, run_id, runtime_generation_id,
               sequence, user_message_id, status, input_json, prepared_text,
               fingerprint, submitted_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
          ).run(
            intervention.interventionId,
            intervention.revision,
            intervention.sessionId,
            intervention.runId,
            intervention.runtimeGenerationId,
            intervention.sequence,
            intervention.userMessageId,
            JSON.stringify(intervention.input),
            input.preparedText,
            input.fingerprint,
            intervention.submittedAt,
            intervention.updatedAt,
          );
          db.prepare(
            `UPDATE queued_turn
             SET status = 'cancelled', revision = ?, terminal_reason = 'converted-to-intervention',
                 updated_at = ?
             WHERE queued_turn_id = ?`,
          ).run(queuedRow.revision + 1, input.updatedAt, input.queuedTurnId);
          // Re-bind the already-painted user row to the target Run so replayed
          // transcripts and remote clients observe intervention delivery, not
          // the former queued-turn projection.
          db.prepare('UPDATE transcript_message SET run_id = ?, metadata_json = ? WHERE id = ?').run(
            intervention.runId,
            JSON.stringify(instructionMetadata(intervention)),
            intervention.userMessageId,
          );
          bumpRevision(1, 1);
          bumpQueueRevision();
          db.exec('COMMIT');
          return {
            outcome: 'converted',
            queuedTurn: rowToQueuedTurn({
              ...queuedRow,
              revision: queuedRow.revision + 1,
              status: 'cancelled',
              terminal_reason: 'converted-to-intervention',
              updated_at: input.updatedAt,
            }),
            intervention,
          };
        } catch (error) {
          rollback(db);
          throw error;
        }
      },

      async expirePendingRunInterventions(runId, terminalReason, updatedAt) {
        ensureOpen();
        const storeApi = ops;
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
        const storeApi = ops;
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
      }
  };
  return ops;
}

function instructionTranscriptExtras(input: UserInstructionPayload): {
  attachments?: MediaAttachmentRef[];
  contextRefs?: UserInstructionPayload['contextRefs'];
} {
  const mediaAttachments = input.attachments?.filter(
    (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
  );
  return {
    ...(mediaAttachments === undefined || mediaAttachments.length === 0
      ? {}
      : { attachments: mediaAttachments }),
    ...(input.contextRefs === undefined || input.contextRefs.length === 0
      ? {}
      : { contextRefs: input.contextRefs }),
  };
}
