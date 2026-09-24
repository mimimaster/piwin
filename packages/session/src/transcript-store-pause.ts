/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

import { randomUUID } from 'node:crypto';
import type { SessionPauseCheckpoint, SessionPauseTurnPolicy } from '@piwin/contracts';
import type { TranscriptStoreCore, SessionTranscriptStore } from './transcript-store.js';
import { isSqliteUniqueConstraint } from './sqlite-errors.js';
import { rowToPauseCheckpoint, type PauseCheckpointRow } from './transcript-store-rows.js';

export function createTranscriptPauseOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  'getPauseCheckpoint' | 'getActivePauseCheckpoint' | 'createPauseCheckpoint' | 'consumePauseCheckpoint' | 'clearPauseCheckpoint'
> {
  const { db, options, ensureOpen, bumpRevision } = core;

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
                   transcript_revision = ?, interrupted_subagent_run_ids_json = ?,
                   turn_policy_json = ?, status = 'active', consumed_at = NULL
               WHERE checkpoint_id = ? AND session_id = ?`,
            ).run(
              input.sourceRunId,
              input.runtimeGenerationId ?? null,
              input.createdAt,
              input.sourceUserMessageId ?? null,
              input.lastAssistantMessageId ?? null,
              input.transcriptRevision,
              runIdListJson(input.interruptedSubagentRunIds),
              turnPolicyJson(input.turnPolicy),
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
        if (input.interruptedSubagentRunIds !== undefined && input.interruptedSubagentRunIds.length > 0) {
          checkpoint.interruptedSubagentRunIds = [...input.interruptedSubagentRunIds];
        }
        if (input.turnPolicy !== undefined && turnPolicyJson(input.turnPolicy) !== null) {
          checkpoint.turnPolicy = { ...input.turnPolicy };
        }
        try {
          db.prepare(
            `INSERT INTO pause_checkpoint(
               checkpoint_id, session_id, source_run_id, runtime_generation_id,
               created_at, source_user_message_id, last_assistant_message_id,
               transcript_revision, interrupted_subagent_run_ids_json, turn_policy_json, status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
          ).run(
            checkpoint.checkpointId,
            checkpoint.sessionId,
            checkpoint.sourceRunId,
            checkpoint.runtimeGenerationId ?? null,
            checkpoint.createdAt,
            checkpoint.sourceUserMessageId ?? null,
            checkpoint.lastAssistantMessageId ?? null,
            checkpoint.transcriptRevision,
            runIdListJson(checkpoint.interruptedSubagentRunIds),
            turnPolicyJson(checkpoint.turnPolicy),
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
      }
  };
}

function runIdListJson(runIds: readonly string[] | undefined): string | null {
  return runIds === undefined || runIds.length === 0 ? null : JSON.stringify(runIds);
}

function turnPolicyJson(policy: SessionPauseTurnPolicy | undefined): string | null {
  if (policy === undefined) return null;
  return policy.orchestrationSchemeId === undefined && policy.delegationMode === undefined
    ? null
    : JSON.stringify(policy);
}
