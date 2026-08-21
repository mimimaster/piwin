/**
 * Split from transcript-store.ts — pure relocation, no behavior change.
 */

import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  SessionTranscriptMessage,
  SessionTranscriptPageData,
  SessionTranscriptPageQuery,
  SessionTranscriptWindowData,
  SessionTranscriptWindowInfo,
  SessionTranscriptWindowQuery,
  SessionUserMessageIndexData,
  SessionUserMessageIndexQuery,
} from '@piwin/contracts';
import {
  SESSION_TRANSCRIPT_PAGE_MAX_BYTES,
  SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MIN_BYTES,
  SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS,
  SESSION_USER_MESSAGE_PREVIEW_CHARS,
} from '@piwin/contracts';
import type { TranscriptStoreCore, SessionTranscriptStore } from './transcript-store.js';
import { projectTranscriptMessagesForUi } from './transcript-ui-projection.js';
import {
  createUserMessageIndexData,
  validateUserMessageIndexQuery,
  type UserMessageIndexRow,
} from './user-message-index.js';
import {
  CURSOR_ALPHABET,
  MAX_CURSOR_CHARS,
  validatePositiveBoundedInteger,
} from './transcript-store-bounds.js';
import {
  countPathIndexedUserMessages,
  countPathRows,
  countPathRowsBeforeSequence,
  withActivePath,
} from './transcript-store-path.js';
import { rowToMessage, type MessageRow } from './transcript-store-rows.js';

const TRANSCRIPT_CURSOR_VERSION = 1;
const TRUNCATION_MARKER = '\n[message truncated in UI history; full content remains on Host]';

type TranscriptCursorPayload = {
  version: number;
  revision: number;
  endSequence: number;
  limit: number;
  maximumBytes: number;
};

function readExactUserMessageIndexRows(db: DatabaseSync, sessionId: string): UserMessageIndexRow[] {
  const rows = db
    .prepare(
      withActivePath(
        `SELECT transcript_message.id, created_at, substr(text, 1, ?) AS preview,
                ROW_NUMBER() OVER (ORDER BY sequence) - 1 AS ordinal
         FROM transcript_message
         JOIN active_path ON transcript_message.id = active_path.id
         WHERE role = 'user' AND length(trim(text)) > 0
         ORDER BY sequence ASC`,
      ),
    )
    .all(sessionId, SESSION_USER_MESSAGE_PREVIEW_CHARS + 1) as unknown as Array<{
    id: string;
    created_at: string;
    preview: string;
    ordinal: number;
  }>;
  return rows.map((row) => ({
    messageId: row.id,
    createdAt: row.created_at,
    ordinal: row.ordinal,
    spanStartOrdinal: row.ordinal,
    spanEndOrdinal: row.ordinal,
    preview: row.preview,
  }));
}

function readSampledUserMessageIndexRows(
  db: DatabaseSync,
  sessionId: string,
  maximumTicks: number,
): UserMessageIndexRow[] {
  const rows = db
    .prepare(
      withActivePath(
        `, user_rows AS (
         SELECT sequence, transcript_message.id AS id,
                ROW_NUMBER() OVER (ORDER BY sequence) - 1 AS ordinal,
                COUNT(*) OVER () AS total
         FROM transcript_message
         JOIN active_path ON transcript_message.id = active_path.id
         WHERE role = 'user' AND length(trim(text)) > 0
       ), bucketed AS (
         SELECT *, CAST(ordinal * ? / total AS INTEGER) AS bucket
         FROM user_rows
       ), representatives AS (
         SELECT bucket, MIN(ordinal) AS span_start_ordinal,
                MAX(ordinal) AS span_end_ordinal,
                MIN(ordinal) AS representative_ordinal
         FROM bucketed
         GROUP BY bucket
         ORDER BY bucket
         LIMIT ?
       )
       SELECT source.id, message.created_at,
              substr(message.text, 1, ?) AS preview,
              source.ordinal,
              representatives.span_start_ordinal,
              representatives.span_end_ordinal
       FROM representatives
       JOIN bucketed AS source
         ON source.ordinal = representatives.representative_ordinal
       JOIN transcript_message AS message
         ON message.sequence = source.sequence
       ORDER BY source.ordinal ASC`,
      ),
    )
    .all(
      sessionId,
      maximumTicks,
      maximumTicks,
      SESSION_USER_MESSAGE_PREVIEW_CHARS + 1,
    ) as unknown as Array<{
    id: string;
    created_at: string;
    preview: string;
    ordinal: number;
    span_start_ordinal: number;
    span_end_ordinal: number;
  }>;
  return rows.map((row) => ({
    messageId: row.id,
    createdAt: row.created_at,
    ordinal: row.ordinal,
    spanStartOrdinal: row.span_start_ordinal,
    spanEndOrdinal: row.span_end_ordinal,
    preview: row.preview,
  }));
}

type TranscriptWindowEntry = {
  sequence: number;
  message: SessionTranscriptMessage;
};

function selectTranscriptWindowMessages(
  entries: readonly TranscriptWindowEntry[],
  anchorMessageId: string,
  maximumBytes: number,
): {
  entries: TranscriptWindowEntry[];
  messages: SessionTranscriptMessage[];
  messageBytes: number;
  anchorOffset: number;
  truncatedMessageIds: string[];
} {
  const anchorIndex = entries.findIndex((entry) => entry.message.id === anchorMessageId);
  const anchor = entries[anchorIndex];
  if (anchor === undefined) {
    return { entries: [], messages: [], messageBytes: 2, anchorOffset: 0, truncatedMessageIds: [] };
  }

  const selected = new Map<string, TranscriptWindowEntry>();
  const truncatedMessageIds: string[] = [];
  let messageBytes = 2;
  const add = (entry: TranscriptWindowEntry, force = false): void => {
    if (selected.has(entry.message.id)) return;
    const delimiterBytes = selected.size === 0 ? 0 : 1;
    let candidate = entry.message;
    let encodedBytes = serializedMessageBytes(candidate);
    if (messageBytes + delimiterBytes + encodedBytes > maximumBytes) {
      if (!force && selected.size > 0) return;
      candidate = clipOversizedMessage(entry.message, maximumBytes - 2);
      encodedBytes = serializedMessageBytes(candidate);
      truncatedMessageIds.push(entry.message.id);
    }
    selected.set(entry.message.id, { ...entry, message: candidate });
    messageBytes += delimiterBytes + encodedBytes;
  };

  add(anchor, true);
  for (let index = anchorIndex + 1; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry) add(entry);
  }
  for (let index = anchorIndex - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry) add(entry);
  }
  const selectedEntries = [...selected.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  return {
    entries: selectedEntries,
    messages: selectedEntries.map((entry) => entry.message),
    messageBytes,
    anchorOffset: Math.max(
      0,
      selectedEntries.findIndex((entry) => entry.message.id === anchorMessageId),
    ),
    truncatedMessageIds,
  };
}

function validateTranscriptPageQuery(query: SessionTranscriptPageQuery, sessionId: string): void {
  if (query.sessionId !== sessionId) {
    throw new RangeError('Session transcript page does not match the opened transcript store');
  }
  validatePositiveBoundedInteger(
    query.limit,
    'Session transcript page limit',
    SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  );
  if (
    !Number.isSafeInteger(query.maximumBytes) ||
    query.maximumBytes < SESSION_TRANSCRIPT_PAGE_MIN_BYTES ||
    query.maximumBytes > SESSION_TRANSCRIPT_PAGE_MAX_BYTES
  ) {
    throw new RangeError(
      `Session transcript page byte limit must be between ${SESSION_TRANSCRIPT_PAGE_MIN_BYTES} and ${SESSION_TRANSCRIPT_PAGE_MAX_BYTES}`,
    );
  }
}

function validateTranscriptWindowQuery(
  query: SessionTranscriptWindowQuery,
  sessionId: string,
): void {
  if (query.sessionId !== sessionId) {
    throw new RangeError('Transcript window session does not match the opened transcript store');
  }
  if (query.anchorMessageId.trim().length === 0 || query.anchorMessageId.length > 256) {
    throw new RangeError('Transcript window anchor message id is invalid');
  }
  if (
    !Number.isSafeInteger(query.beforeItems) ||
    query.beforeItems < 0 ||
    !Number.isSafeInteger(query.afterItems) ||
    query.afterItems < 0 ||
    query.beforeItems + query.afterItems + 1 > SESSION_TRANSCRIPT_WINDOW_MAX_ITEMS
  ) {
    throw new RangeError('Transcript window item limits are invalid');
  }
  if (
    !Number.isSafeInteger(query.maximumBytes) ||
    query.maximumBytes < SESSION_TRANSCRIPT_PAGE_MIN_BYTES ||
    query.maximumBytes > SESSION_TRANSCRIPT_PAGE_MAX_BYTES
  ) {
    throw new RangeError('Transcript window byte limit is invalid');
  }
}

/**
 * One token algorithm for every transcript-revision surface (pages, windows,
 * branch lists): clients compare tokens across responses, so a second
 * algorithm would make identical revisions look different.
 */
export function transcriptRevisionToken(sessionId: string, revision: number): string {
  return createHash('sha256').update(`${sessionId}\u0000${revision}`).digest('hex');
}

function encodeTranscriptCursor(payload: TranscriptCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeTranscriptCursor(value: string): TranscriptCursorPayload {
  if (value.length === 0 || value.length > MAX_CURSOR_CHARS || !CURSOR_ALPHABET.test(value)) {
    throw new RangeError('Session transcript cursor encoding is invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new RangeError('Session transcript cursor payload is invalid');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new RangeError('Session transcript cursor payload must be an object');
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== TRANSCRIPT_CURSOR_VERSION ||
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    typeof record.endSequence !== 'number' ||
    !Number.isSafeInteger(record.endSequence) ||
    record.endSequence <= 0 ||
    typeof record.limit !== 'number' ||
    !Number.isSafeInteger(record.limit) ||
    record.limit <= 0 ||
    record.limit > SESSION_TRANSCRIPT_PAGE_MAX_ITEMS ||
    typeof record.maximumBytes !== 'number' ||
    !Number.isSafeInteger(record.maximumBytes) ||
    record.maximumBytes < SESSION_TRANSCRIPT_PAGE_MIN_BYTES ||
    record.maximumBytes > SESSION_TRANSCRIPT_PAGE_MAX_BYTES
  ) {
    throw new RangeError('Session transcript cursor fields are invalid');
  }
  return {
    version: record.version,
    revision: record.revision,
    endSequence: record.endSequence,
    limit: record.limit,
    maximumBytes: record.maximumBytes,
  };
}

function serializedMessageBytes(message: SessionTranscriptMessage): number {
  return Buffer.byteLength(JSON.stringify(message), 'utf8');
}

function clipOversizedMessage(
  message: SessionTranscriptMessage,
  maximumEncodedBytes: number,
): SessionTranscriptMessage {
  const base: SessionTranscriptMessage = {
    id: message.id,
    role: message.role,
    text: TRUNCATION_MARKER,
    createdAt: message.createdAt,
    status: message.status,
  };
  if (message.runId !== undefined) base.runId = message.runId;
  if (message.startedAt !== undefined) base.startedAt = message.startedAt;
  if (message.endedAt !== undefined) base.endedAt = message.endedAt;
  if (message.outcome !== undefined) base.outcome = message.outcome;
  if (message.model !== undefined) base.model = message.model;
  if (message.searchEvidence !== undefined) base.searchEvidence = message.searchEvidence;
  if (serializedMessageBytes(base) > maximumEncodedBytes) {
    throw new RangeError('Session transcript page byte limit cannot fit message metadata');
  }
  let lowerBound = 0;
  let upperBound = message.text.length;
  while (lowerBound < upperBound) {
    const midpoint = Math.ceil((lowerBound + upperBound) / 2);
    const candidate = {
      ...base,
      text: `${safePrefix(message.text, midpoint)}${TRUNCATION_MARKER}`,
    };
    if (serializedMessageBytes(candidate) <= maximumEncodedBytes) {
      lowerBound = midpoint;
    } else {
      upperBound = midpoint - 1;
    }
  }
  return { ...base, text: `${safePrefix(message.text, lowerBound)}${TRUNCATION_MARKER}` };
}

function safePrefix(value: string, length: number): string {
  if (length <= 0) return '';
  let end = Math.min(length, value.length);
  const trailingCodeUnit = value.charCodeAt(end - 1);
  if (trailingCodeUnit >= 0xd800 && trailingCodeUnit <= 0xdbff) {
    end -= 1;
  }
  return value.slice(0, end);
}

export function createTranscriptPagesOps(
  core: TranscriptStoreCore,
): Pick<
  SessionTranscriptStore,
  'transcriptPage' | 'userMessageIndex' | 'transcriptWindow'
> {
  const { db, options, ensureOpen, currentRevision, currentUserMessageRevision } = core;

  return {
      async transcriptPage(query) {
        ensureOpen();
        validateTranscriptPageQuery(query, options.sessionId);
        const revision = currentRevision();
        const totalCount = countPathRows(db, options.sessionId);
        const cursor =
          query.beforeCursor === undefined ? null : decodeTranscriptCursor(query.beforeCursor);
        if (cursor !== null && cursor.revision !== revision) {
          return {
            status: 'stale-cursor',
            currentRevision: transcriptRevisionToken(options.sessionId, revision),
          };
        }
        if (
          cursor !== null &&
          (cursor.limit !== query.limit || cursor.maximumBytes !== query.maximumBytes)
        ) {
          return {
            status: 'stale-cursor',
            currentRevision: transcriptRevisionToken(options.sessionId, revision),
          };
        }
        const endSequence = cursor?.endSequence ?? Number.MAX_SAFE_INTEGER;
        const rows = db
          .prepare(
            withActivePath(
              `SELECT transcript_message.* FROM transcript_message
               JOIN active_path ON transcript_message.id = active_path.id
               WHERE transcript_message.sequence < ?
               ORDER BY transcript_message.sequence DESC LIMIT ?`,
            ),
          )
          .all(options.sessionId, endSequence, query.limit) as unknown as MessageRow[];
        const chronologicalRows = rows.reverse();
        const selectedMessages: SessionTranscriptMessage[] = [];
        const selectedSequences: number[] = [];
        const truncatedMessageIds: string[] = [];
        let messageBytes = 2;
        for (let index = chronologicalRows.length - 1; index >= 0; index -= 1) {
          const row = chronologicalRows[index];
          if (row === undefined) {
            continue;
          }
          const source = projectTranscriptMessagesForUi([rowToMessage(row)])[0];
          if (source === undefined) {
            continue;
          }
          const delimiterBytes = selectedMessages.length === 0 ? 0 : 1;
          let projected = source;
          let encodedBytes = serializedMessageBytes(projected);
          if (messageBytes + delimiterBytes + encodedBytes > query.maximumBytes) {
            if (selectedMessages.length > 0) {
              break;
            }
            projected = clipOversizedMessage(source, query.maximumBytes - 2);
            encodedBytes = serializedMessageBytes(projected);
            truncatedMessageIds.push(source.id);
          }
          selectedMessages.unshift(projected);
          selectedSequences.unshift(row.sequence);
          messageBytes += delimiterBytes + encodedBytes;
        }
        const oldestSelectedSequence = selectedSequences[0];
        const hasOlder =
          oldestSelectedSequence !== undefined &&
          db
            .prepare(
              withActivePath(
                `SELECT 1 FROM transcript_message
                 JOIN active_path ON transcript_message.id = active_path.id
                 WHERE transcript_message.sequence < ? LIMIT 1`,
              ),
            )
            .get(options.sessionId, oldestSelectedSequence) !== undefined;
        const endIndex =
          cursor === null
            ? totalCount
            : countPathRowsBeforeSequence(db, options.sessionId, cursor.endSequence);
        const startIndex = Math.max(0, endIndex - selectedMessages.length);
        const page = {
          revision: transcriptRevisionToken(options.sessionId, revision),
          totalCount,
          startIndex,
          endIndex,
          messageBytes,
        };
        const resultPage: typeof page & { truncatedMessageIds?: string[]; olderCursor?: string } =
          page;
        if (truncatedMessageIds.length > 0) {
          resultPage.truncatedMessageIds = truncatedMessageIds;
        }
        if (hasOlder && oldestSelectedSequence !== undefined) {
          resultPage.olderCursor = encodeTranscriptCursor({
            version: TRANSCRIPT_CURSOR_VERSION,
            revision,
            endSequence: oldestSelectedSequence,
            limit: query.limit,
            maximumBytes: query.maximumBytes,
          });
        }
        return { status: 'page', messages: selectedMessages, page: resultPage };
      },

      async userMessageIndex(query) {
        ensureOpen();
        validateUserMessageIndexQuery(query, options.sessionId);
        const totalUserMessages = countPathIndexedUserMessages(db, options.sessionId);
        const rows =
          totalUserMessages <= query.maximumTicks
            ? readExactUserMessageIndexRows(db, options.sessionId)
            : readSampledUserMessageIndexRows(db, options.sessionId, query.maximumTicks);
        return createUserMessageIndexData({
          sessionId: options.sessionId,
          revision: transcriptRevisionToken(options.sessionId, currentUserMessageRevision()),
          totalUserMessages,
          maximumTicks: query.maximumTicks,
          rows,
        });
      },

      async transcriptWindow(query) {
        ensureOpen();
        validateTranscriptWindowQuery(query, options.sessionId);
        // Off-path anchors report not-found: a window can only open on the
        // active branch (callers re-anchor after a branch switch).
        const anchorRow = db
          .prepare(
            withActivePath(
              `SELECT transcript_message.* FROM transcript_message
               JOIN active_path ON transcript_message.id = active_path.id
               WHERE transcript_message.id = ?`,
            ),
          )
          .get(options.sessionId, query.anchorMessageId) as unknown as MessageRow | undefined;
        if (anchorRow === undefined) {
          return { status: 'not-found' };
        }

        const beforeRows = db
          .prepare(
            withActivePath(
              `SELECT transcript_message.* FROM transcript_message
               JOIN active_path ON transcript_message.id = active_path.id
               WHERE transcript_message.sequence < ?
               ORDER BY transcript_message.sequence DESC LIMIT ?`,
            ),
          )
          .all(options.sessionId, anchorRow.sequence, query.beforeItems) as unknown as MessageRow[];
        beforeRows.reverse();
        const afterRows = db
          .prepare(
            withActivePath(
              `SELECT transcript_message.* FROM transcript_message
               JOIN active_path ON transcript_message.id = active_path.id
               WHERE transcript_message.sequence > ?
               ORDER BY transcript_message.sequence ASC LIMIT ?`,
            ),
          )
          .all(options.sessionId, anchorRow.sequence, query.afterItems) as unknown as MessageRow[];
        const entries = [...beforeRows, anchorRow, ...afterRows].map((row) => ({
          sequence: row.sequence,
          message: projectTranscriptMessagesForUi([rowToMessage(row)])[0] ?? rowToMessage(row),
        }));
        const selected = selectTranscriptWindowMessages(
          entries,
          query.anchorMessageId,
          query.maximumBytes,
        );
        const selectedSequences = selected.entries.map((entry) => entry.sequence);
        const firstSequence = selectedSequences[0] ?? anchorRow.sequence;
        const lastSequence = selectedSequences[selectedSequences.length - 1] ?? anchorRow.sequence;
        const totalCount = countPathRows(db, options.sessionId);
        const page: SessionTranscriptWindowInfo = {
          revision: transcriptRevisionToken(options.sessionId, currentRevision()),
          totalCount,
          startIndex: countPathRowsBeforeSequence(db, options.sessionId, firstSequence),
          endIndex: countPathRowsBeforeSequence(db, options.sessionId, lastSequence) + 1,
          messageBytes: selected.messageBytes,
          anchorMessageId: query.anchorMessageId,
          anchorOffset: selected.anchorOffset,
        };
        if (selected.truncatedMessageIds.length > 0) {
          page.truncatedMessageIds = selected.truncatedMessageIds;
        }
        return { status: 'window', messages: selected.messages, window: page };
      }
  };
}
