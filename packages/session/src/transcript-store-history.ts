/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

import type {
  ModelRef,
  SessionOutlineNode,
  SessionOutlinePageData,
  SessionOutlinePageQuery,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import type { TranscriptStoreCore, SessionTranscriptStore } from './transcript-store.js';
import {
  MAX_CURSOR_CHARS,
  validatePositiveBoundedInteger,
} from './transcript-store-bounds.js';
import { rowToMessage, type MessageRow } from './transcript-store-rows.js';

/** A streamed full-transcript read observed a concurrent transcript mutation. */
export class TranscriptIterationStaleError extends Error {
  public readonly name = 'TranscriptIterationStaleError';
}

const OUTLINE_PREVIEW_CHARS = 120;
const DEFAULT_HISTORY_MESSAGES = 40;
const DEFAULT_HISTORY_CHARS = 24_000;
const MAX_HISTORY_MESSAGES = 200;
const MAX_HISTORY_CHARS = 200_000;
const MAX_ITERATION_BATCH = 1_000;
const OUTLINE_CURSOR_VERSION = 1;

type OutlineCursorPayload = {
  version: number;
  revision: number;
  endSequence: number;
};

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

function validateOutlineQuery(query: SessionOutlinePageQuery, sessionId: string): void {
  if (query.sessionId !== sessionId) {
    throw new RangeError('Session outline page does not match the opened transcript store');
  }
  validatePositiveBoundedInteger(query.limit, 'Session outline page limit', 100);
  if (query.beforeCursor !== undefined && query.beforeCursor.length > MAX_CURSOR_CHARS) {
    throw new RangeError('Session outline page cursor is too long');
  }
}

export function createTranscriptHistoryOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  'buildHistoryWindow' | 'recentModel' | 'outlinePage' | 'iterateAll'
> {
  const { db, options, ensureOpen, currentRevision } = core;

  return {
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
      }
  };
}
