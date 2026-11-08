import type { DatabaseSync } from 'node:sqlite';
import {
  SESSION_TRANSCRIPT_PAGE_MAX_LOCATE_IDS,
  type SessionTranscriptPageInfo,
} from '@piwin/contracts';
import { withActivePath } from './transcript-store-path.js';

/** Locate only requested identities; message bodies stay behind the page byte cap. */
export function readTranscriptMessagePositions(
  db: DatabaseSync,
  sessionId: string,
  messageIds: readonly string[],
): NonNullable<SessionTranscriptPageInfo['messagePositions']> {
  if (
    !Array.isArray(messageIds) ||
    messageIds.length > SESSION_TRANSCRIPT_PAGE_MAX_LOCATE_IDS ||
    messageIds.some((id) => typeof id !== 'string' || id.trim().length === 0 || id.length > 256)
  ) {
    throw new RangeError('Session transcript locate message ids are invalid');
  }
  const uniqueIds = [...new Set(messageIds)];
  if (uniqueIds.length === 0) return [];
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      withActivePath(`, ordered_messages AS (
    SELECT transcript_message.id, ROW_NUMBER() OVER (ORDER BY sequence) - 1 AS position
    FROM transcript_message JOIN active_path ON transcript_message.id = active_path.id
  ) SELECT id, position FROM ordered_messages WHERE id IN (${placeholders}) ORDER BY position`),
    )
    .all(sessionId, ...uniqueIds) as unknown as Array<{ id: string; position: number }>;
  return rows.map((row) => ({ messageId: row.id, index: row.position }));
}
