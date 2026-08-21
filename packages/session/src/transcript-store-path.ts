/**
 * Active-path scoping for the conversation tree (ADR 0055).
 *
 * The transcript is a tree: rows point at their parent and `transcript_meta`
 * tracks one active leaf. Every user-facing read (tail, pages, outline,
 * history, search) sees exactly the root→leaf chain of the active branch —
 * sibling branches stay stored but invisible until switched to.
 *
 * Global (whole-table) reads remain deliberate exceptions: provenance replay
 * checks, `getMessage` by id, legacy-import verification counts.
 */

import type { DatabaseSync } from 'node:sqlite';

/**
 * Recursive CTE enumerating the active path (leaf → root). Consumes one bind
 * parameter: the session id. Prepend via {@link withActivePath} and pass the
 * session id as the first bind argument of the combined statement.
 */
const ACTIVE_PATH_CTE = `WITH RECURSIVE active_path(id) AS (
  SELECT active_leaf_message_id FROM transcript_meta
   WHERE session_id = ? AND active_leaf_message_id IS NOT NULL
  UNION ALL
  SELECT m.parent_message_id FROM transcript_message m
  JOIN active_path p ON m.id = p.id
  WHERE m.parent_message_id IS NOT NULL
)`;

/**
 * Wrap a SELECT so it can join `active_path`. The caller's SQL must reference
 * the `active_path` table (normally `JOIN active_path ON …`), and the first
 * bind argument must be the session id.
 */
export function withActivePath(sql: string): string {
  return `${ACTIVE_PATH_CTE}\n${sql}`;
}

/** Number of rows on the active path (the path-scoped `store.count()`). */
export function countPathRows(db: DatabaseSync, sessionId: string): number {
  const row = db
    .prepare(withActivePath('SELECT COUNT(*) AS count FROM active_path'))
    .get(sessionId) as { count: number };
  return row.count;
}

/** Path rows strictly before a sequence (path-scoped page indexing). */
export function countPathRowsBeforeSequence(
  db: DatabaseSync,
  sessionId: string,
  sequence: number,
): number {
  const row = db
    .prepare(
      withActivePath(
        `SELECT COUNT(*) AS count FROM transcript_message
         JOIN active_path ON transcript_message.id = active_path.id
         WHERE transcript_message.sequence < ?`,
      ),
    )
    .get(sessionId, sequence) as { count: number };
  return row.count;
}

/** Non-empty user-authored rows on the active path (user message index). */
export function countPathIndexedUserMessages(db: DatabaseSync, sessionId: string): number {
  const row = db
    .prepare(
      withActivePath(
        `SELECT COUNT(*) AS count FROM transcript_message
         JOIN active_path ON transcript_message.id = active_path.id
         WHERE transcript_message.role = 'user'
           AND length(trim(transcript_message.text)) > 0`,
      ),
    )
    .get(sessionId) as { count: number };
  return row.count;
}
