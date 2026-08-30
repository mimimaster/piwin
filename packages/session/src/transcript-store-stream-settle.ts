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
};

export function createTranscriptStreamSettleOps(
  core: TranscriptStoreCore,
): Pick<SessionTranscriptStore, 'settleStreamingMessages'> {
  const { db, ensureOpen, bumpRevision } = core;

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
