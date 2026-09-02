/** Durable product-side compaction boundaries for runtime reconstruction. */

import type { SessionCompactionRecord, SessionCompactionRecordInput } from '@piwin/contracts';
import type { SessionTranscriptStore, TranscriptStoreCore } from './transcript-store.js';
import { withActivePath } from './transcript-store-path.js';

/** Schema fragment kept separate so old SQLite stores gain it on open. */
export const SESSION_COMPACTION_DDL = `
    CREATE TABLE IF NOT EXISTS session_compaction(
      compaction_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      anchor_message_id TEXT,
      first_kept_entry_id TEXT,
      summary TEXT NOT NULL,
      tokens_before INTEGER,
      tokens_after INTEGER,
      runtime_generation_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_compaction_session
      ON session_compaction(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_session_compaction_anchor
      ON session_compaction(anchor_message_id);
`;

type CompactionRow = {
  compaction_id: string;
  session_id: string;
  anchor_message_id: string | null;
  first_kept_entry_id: string | null;
  summary: string;
  tokens_before: number | null;
  tokens_after: number | null;
  runtime_generation_id: string | null;
  created_at: string;
};

const MAX_COMPACTION_SUMMARY_CHARS = 400_000;

export function createTranscriptCompactionOps(
  core: TranscriptStoreCore,
): Pick<SessionTranscriptStore, 'recordCompaction' | 'readLatestCompaction'> {
  const { db, options, ensureOpen } = core;

  return {
    async recordCompaction(input: SessionCompactionRecordInput): Promise<void> {
      ensureOpen();
      const summary = input.summary.trim();
      if (summary.length === 0) {
        throw new RangeError('Compaction summary must not be empty');
      }
      if (summary.length > MAX_COMPACTION_SUMMARY_CHARS) {
        throw new RangeError('Compaction summary exceeds the durable limit');
      }
      if (input.compactionId.trim().length === 0) {
        throw new RangeError('Compaction id must not be empty');
      }
      if (input.createdAt.trim().length === 0) {
        throw new RangeError('Compaction createdAt must not be empty');
      }

      // The explicit compact command and the native recorder can observe the
      // same successful operation with different optional evidence: one path
      // may have `estimatedTokensAfter` while the other only has the summary.
      // Treat matching content at one transcript anchor as an idempotent
      // replay, then merge the richer fields instead of creating two durable
      // boundaries whose token suffixes disagree.
      const candidates = db
        .prepare(
          `SELECT * FROM session_compaction
           WHERE session_id = ?
             AND anchor_message_id IS ?
             AND summary = ?
           ORDER BY created_at ASC, compaction_id ASC`,
        )
        .all(options.sessionId, input.anchorMessageId, summary) as CompactionRow[];
      const duplicate = candidates.find(
        (row) =>
          input.firstKeptEntryId === undefined ||
          row.first_kept_entry_id === null ||
          row.first_kept_entry_id === input.firstKeptEntryId,
      );
      if (duplicate !== undefined) {
        db.prepare(
          `UPDATE session_compaction SET
             first_kept_entry_id = COALESCE(first_kept_entry_id, ?),
             tokens_before = COALESCE(tokens_before, ?),
             tokens_after = COALESCE(tokens_after, ?),
             runtime_generation_id = COALESCE(runtime_generation_id, ?)
           WHERE compaction_id = ?`,
        ).run(
          input.firstKeptEntryId ?? null,
          input.tokensBefore ?? null,
          input.tokensAfter ?? null,
          input.runtimeGenerationId ?? null,
          duplicate.compaction_id,
        );
        return;
      }

      db.prepare(
        `INSERT INTO session_compaction(
          compaction_id, session_id, anchor_message_id, first_kept_entry_id,
          summary, tokens_before, tokens_after, runtime_generation_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(compaction_id) DO UPDATE SET
          anchor_message_id = excluded.anchor_message_id,
          first_kept_entry_id = excluded.first_kept_entry_id,
          summary = excluded.summary,
          tokens_before = excluded.tokens_before,
          tokens_after = excluded.tokens_after,
          runtime_generation_id = excluded.runtime_generation_id,
          created_at = excluded.created_at`,
      ).run(
        input.compactionId,
        options.sessionId,
        input.anchorMessageId,
        input.firstKeptEntryId ?? null,
        summary,
        input.tokensBefore ?? null,
        input.tokensAfter ?? null,
        input.runtimeGenerationId ?? null,
        input.createdAt,
      );
    },

    async readLatestCompaction(): Promise<SessionCompactionRecord | undefined> {
      ensureOpen();
      const row = db
        .prepare(
          withActivePath(
            `SELECT c.* FROM session_compaction c
             LEFT JOIN active_path p ON p.id = c.anchor_message_id
             WHERE c.session_id = ?
               AND (c.anchor_message_id IS NULL OR p.id IS NOT NULL)
             ORDER BY c.created_at DESC, c.compaction_id DESC
             LIMIT 1`,
          ),
        )
        // The active-path CTE consumes the first bind; the session filter in
        // the query consumes the second one.
        .get(options.sessionId, options.sessionId) as CompactionRow | undefined;
      return row === undefined ? undefined : rowToCompaction(row);
    },
  };
}

function rowToCompaction(row: CompactionRow): SessionCompactionRecord {
  const record: SessionCompactionRecord = {
    compactionId: row.compaction_id,
    sessionId: row.session_id,
    anchorMessageId: row.anchor_message_id,
    summary: row.summary,
    createdAt: row.created_at,
  };
  if (row.first_kept_entry_id !== null) record.firstKeptEntryId = row.first_kept_entry_id;
  if (row.tokens_before !== null) record.tokensBefore = row.tokens_before;
  if (row.tokens_after !== null) record.tokensAfter = row.tokens_after;
  if (row.runtime_generation_id !== null) record.runtimeGenerationId = row.runtime_generation_id;
  return record;
}
