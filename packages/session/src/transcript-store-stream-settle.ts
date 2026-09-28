/**
 * Crash/abort recovery: close durable assistant rows left `streaming`.
 */

import type { SessionRunOutcome, SessionTranscriptMessage } from '@piwin/contracts';
import { rollback } from './sqlite-errors.js';
import type { SessionTranscriptStore, TranscriptStoreCore } from './transcript-store.js';
import { rowToMessage, type MessageRow } from './transcript-store-rows.js';

export type SettleStreamingMessagesInput = {
  /** When set, only assistant rows for this run are closed. */
  runId?: string;
  updatedAt: string;
  outcome: SessionRunOutcome;
  terminalMessage?: string;
  failure?: SessionTranscriptMessage['failure'];
  agentStopReason?: SessionTranscriptMessage['agentStopReason'];
  idleLoop?: SessionTranscriptMessage['idleLoop'];
};

export function createTranscriptStreamSettleOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  'settleStreamingMessages' | 'ensureFailedRunAssistant' | 'dismissRunIdleLoop'
> {
  const { db, ensureOpen, bumpRevision, insertMessageRow } = core;

  return {
    async settleStreamingMessages(input) {
      ensureOpen();
      db.exec('BEGIN IMMEDIATE');
      try {
        // Orphan recovery (no runId): only close leftover streams.
        // Run finalization also stamps done/error rows that never received an
        // outcome (failure evidence often lands as done+failure, not streaming).
        const rows =
          input.runId === undefined
            ? (db
                .prepare(
                  `SELECT * FROM transcript_message
                   WHERE role = 'assistant' AND status = 'streaming'
                   ORDER BY sequence ASC`,
                )
                .all() as unknown as MessageRow[])
            : (db
                .prepare(
                  `SELECT * FROM transcript_message
                   WHERE role = 'assistant'
                     AND run_id = ?
                     AND (
                       status = 'streaming'
                       OR status = 'error'
                       OR (
                         status = 'done'
                         AND (
                           metadata_json IS NULL
                           OR json_extract(metadata_json, '$.outcome') IS NULL
                         )
                       )
                     )
                   ORDER BY sequence ASC`,
                )
                .all(input.runId) as unknown as MessageRow[]);
        if (rows.length === 0) {
          db.exec('COMMIT');
          return [];
        }
        const update = db.prepare(
          `UPDATE transcript_message SET status = 'done', metadata_json = ? WHERE id = ?`,
        );
        const settled: SessionTranscriptMessage[] = [];
        for (const row of rows) {
          const metadata = mergeSettledMetadata(row.metadata_json, input);
          update.run(JSON.stringify(metadata), row.id);
          settled.push(
            rowToMessage({
              ...row,
              status: 'done',
              metadata_json: JSON.stringify(metadata),
            }),
          );
        }
        bumpRevision(rows.length);
        db.exec('COMMIT');
        return settled;
      } catch (error) {
        rollback(db);
        throw error;
      }
    },
    async ensureFailedRunAssistant(input) {
      ensureOpen();
      db.exec('BEGIN IMMEDIATE');
      try {
        const latest = db
          .prepare(
            `SELECT * FROM transcript_message
             WHERE role = 'assistant' AND run_id = ?
             ORDER BY sequence DESC
             LIMIT 1`,
          )
          .get(input.runId) as MessageRow | undefined;
        const metadataInput = {
          updatedAt: input.updatedAt,
          outcome: 'failed' as const,
          terminalMessage: input.terminalMessage,
          failure: input.failure,
        };
        if (latest !== undefined) {
          const metadata = mergeSettledMetadata(latest.metadata_json, metadataInput);
          db.prepare(
            `UPDATE transcript_message SET status = 'error', metadata_json = ? WHERE id = ?`,
          ).run(JSON.stringify(metadata), latest.id);
          bumpRevision(1);
          db.exec('COMMIT');
          return rowToMessage({
            ...latest,
            status: 'error',
            metadata_json: JSON.stringify(metadata),
          });
        }
        const failureId = `piw-m-error-${input.runId}`;
        const existingSynthetic = db
          .prepare('SELECT * FROM transcript_message WHERE id = ?')
          .get(failureId) as MessageRow | undefined;
        if (existingSynthetic !== undefined) {
          const metadata = mergeSettledMetadata(existingSynthetic.metadata_json, metadataInput);
          db.prepare(
            `UPDATE transcript_message SET status = 'error', metadata_json = ? WHERE id = ?`,
          ).run(JSON.stringify(metadata), existingSynthetic.id);
          bumpRevision(1);
          db.exec('COMMIT');
          return rowToMessage({
            ...existingSynthetic,
            status: 'error',
            metadata_json: JSON.stringify(metadata),
          });
        }
        insertMessageRow({
          id: failureId,
          runtimeGenerationId: 'host-runtime-failure',
          backendMessageId: failureId,
          role: 'assistant',
          text: '',
          thinking: '',
          status: 'error',
          createdAt: input.updatedAt,
          runId: input.runId,
          tools: [],
          metadata: {
            failure: input.failure,
            outcome: 'failed',
            terminalMessage: input.terminalMessage,
            endedAt: input.updatedAt,
          },
        });
        bumpRevision(1);
        db.exec('COMMIT');
        const inserted = db
          .prepare('SELECT * FROM transcript_message WHERE id = ?')
          .get(failureId) as MessageRow;
        return rowToMessage(inserted);
      } catch (error) {
        rollback(db);
        throw error;
      }
    },
    async dismissRunIdleLoop(runId) {
      ensureOpen();
      const result = db
        .prepare(
          `UPDATE transcript_message
           SET metadata_json = json_set(metadata_json, '$.idleLoop.dismissed', json('true'))
           WHERE role = 'assistant'
             AND run_id = ?
             AND json_extract(metadata_json, '$.idleLoop') IS NOT NULL
             AND coalesce(json_extract(metadata_json, '$.idleLoop.dismissed'), 0) = 0`,
        )
        .run(runId);
      const changed = Number(result.changes);
      if (changed > 0) bumpRevision(changed);
      return changed;
    },
  };
}

function mergeSettledMetadata(
  metadataJson: string | null,
  input: SettleStreamingMessagesInput,
): NonNullable<import('./transcript-store.js').TranscriptStoreMessageInput['metadata']> {
  const previous =
    metadataJson === null || metadataJson.length === 0
      ? {}
      : (JSON.parse(metadataJson) as NonNullable<
          import('./transcript-store.js').TranscriptStoreMessageInput['metadata']
        >);
  const next = {
    ...previous,
    endedAt: input.updatedAt,
    outcome: input.outcome,
  };
  if (input.agentStopReason !== undefined) {
    next.agentStopReason = input.agentStopReason;
  }
  if (input.idleLoop !== undefined) {
    // A dismissal persisted before this stamp must survive it.
    next.idleLoop =
      previous.idleLoop?.dismissed === true ? { ...input.idleLoop, dismissed: true } : input.idleLoop;
  }
  if (input.outcome === 'failed') {
    if (input.terminalMessage !== undefined) {
      next.terminalMessage = input.terminalMessage;
    }
    if (input.failure !== undefined) {
      next.failure = input.failure;
    }
  } else {
    delete next.terminalMessage;
    delete next.failure;
    if (
      (input.outcome === 'cancelled' || input.outcome === 'paused') &&
      input.terminalMessage !== undefined
    ) {
      next.terminalMessage = input.terminalMessage;
    }
  }
  if (previous.thinkingStartedAt !== undefined && previous.thinkingEndedAt === undefined) {
    next.thinkingEndedAt = input.updatedAt;
  }
  return next;
}
