import { createHash } from 'node:crypto';
import {
  SESSION_TRANSCRIPT_PAGE_MAX_BYTES,
  SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MIN_BYTES,
  type SessionTranscriptMessage,
  type SessionTranscriptPageQuery,
  type SessionTranscriptPageResult,
} from '@piwin/contracts';
import { projectTranscriptMessagesForUi } from './transcript-ui-projection.js';

const CURSOR_VERSION = 1;
const MAX_CURSOR_CHARS = 512;
const CURSOR_ALPHABET = /^[A-Za-z0-9_-]+$/;
const REVISION_PATTERN = /^[a-f0-9]{64}$/;
const TRUNCATION_MARKER = '\n[message truncated in UI history; full content remains on Host]';

type TranscriptCursorPayload = {
  version: number;
  revision: string;
  endIndex: number;
  limit: number;
  maximumBytes: number;
};

export class SessionTranscriptCursorError extends Error {
  public readonly name = 'SessionTranscriptCursorError';
}

/** Build one newest-first window while preserving chronological message order. */
export function createSessionTranscriptPage(
  messages: readonly SessionTranscriptMessage[],
  query: SessionTranscriptPageQuery,
): SessionTranscriptPageResult<SessionTranscriptMessage> {
  validateQuery(query);
  const projectedMessages = projectTranscriptMessagesForUi(messages);
  const revision = createProjectionRevision(projectedMessages, query.sessionId);
  const cursor = query.beforeCursor === undefined ? null : decodeCursor(query.beforeCursor);

  if (cursor !== null && cursor.revision !== revision) {
    return { status: 'stale-cursor', currentRevision: revision };
  }
  if (
    cursor !== null &&
    (cursor.limit !== query.limit || cursor.maximumBytes !== query.maximumBytes)
  ) {
    // Page defaults can change across Desktop/Host versions or during a local
    // HMR cycle. The cursor is still well-formed, but it cannot continue under
    // different bounds. Route it through the same one-restart recovery as a
    // revision change instead of turning normal compatibility drift into an
    // action failure.
    return { status: 'stale-cursor', currentRevision: revision };
  }

  const endIndex = cursor?.endIndex ?? projectedMessages.length;
  if (cursor !== null && (endIndex <= 0 || endIndex > projectedMessages.length)) {
    throw new SessionTranscriptCursorError(
      'Session transcript cursor boundary is outside the collection',
    );
  }

  const selectedMessages: SessionTranscriptMessage[] = [];
  const encodedMessageBytes: number[] = [];
  const truncatedMessageIds: string[] = [];
  let startIndex = endIndex;
  let messageBytes = 2;

  while (startIndex > 0 && selectedMessages.length < query.limit) {
    const sourceMessage = projectedMessages[startIndex - 1];
    if (sourceMessage === undefined) {
      break;
    }
    let projectedMessage = sourceMessage;
    let encodedBytes = serializedBytes(projectedMessage);
    const delimiterBytes = selectedMessages.length === 0 ? 0 : 1;

    if (messageBytes + delimiterBytes + encodedBytes > query.maximumBytes) {
      if (selectedMessages.length > 0) {
        break;
      }
      projectedMessage = clipOversizedMessage(sourceMessage, query.maximumBytes - 2);
      encodedBytes = serializedBytes(projectedMessage);
      if (messageBytes + encodedBytes > query.maximumBytes) {
        throw new RangeError('Session transcript page byte limit cannot fit message metadata');
      }
      truncatedMessageIds.push(sourceMessage.id);
    }

    selectedMessages.unshift(projectedMessage);
    encodedMessageBytes.unshift(encodedBytes);
    startIndex -= 1;
    messageBytes =
      2 +
      encodedMessageBytes.reduce((total, value) => total + value, 0) +
      Math.max(0, encodedMessageBytes.length - 1);
  }

  const page = {
    revision,
    totalCount: projectedMessages.length,
    startIndex,
    endIndex,
    messageBytes,
  };
  const resultPage: typeof page & {
    truncatedMessageIds?: string[];
    olderCursor?: string;
  } = page;
  if (truncatedMessageIds.length > 0) {
    resultPage.truncatedMessageIds = truncatedMessageIds;
  }
  if (startIndex > 0) {
    resultPage.olderCursor = encodeCursor({
      version: CURSOR_VERSION,
      revision,
      endIndex: startIndex,
      limit: query.limit,
      maximumBytes: query.maximumBytes,
    });
  }

  return { status: 'page', messages: selectedMessages, page: resultPage };
}

function createProjectionRevision(
  messages: readonly SessionTranscriptMessage[],
  sessionId: string,
): string {
  const hash = createHash('sha256');
  hash.update(sessionId);
  hash.update(`\u0000${messages.length}`);
  for (const message of messages) {
    hash.update('\u0000');
    hash.update(JSON.stringify(message));
  }
  return hash.digest('hex');
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
  if (message.thinkingStartedAt !== undefined) base.thinkingStartedAt = message.thinkingStartedAt;
  if (message.thinkingEndedAt !== undefined) base.thinkingEndedAt = message.thinkingEndedAt;
  if (message.outcome !== undefined) base.outcome = message.outcome;
  if (message.model !== undefined) base.model = message.model;

  if (serializedBytes(base) > maximumEncodedBytes) {
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
    if (serializedBytes(candidate) <= maximumEncodedBytes) {
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

function validateQuery(query: SessionTranscriptPageQuery): void {
  if (query.sessionId.length === 0 || query.sessionId.length > 256) {
    throw new RangeError('Session transcript page requires a valid session id');
  }
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit <= 0 ||
    query.limit > SESSION_TRANSCRIPT_PAGE_MAX_ITEMS
  ) {
    throw new RangeError(
      `Session transcript page limit must be between 1 and ${SESSION_TRANSCRIPT_PAGE_MAX_ITEMS}`,
    );
  }
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

function serializedBytes(value: SessionTranscriptMessage): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function encodeCursor(payload: TranscriptCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(value: string): TranscriptCursorPayload {
  if (value.length === 0 || value.length > MAX_CURSOR_CHARS || !CURSOR_ALPHABET.test(value)) {
    throw new SessionTranscriptCursorError('Session transcript cursor encoding is invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new SessionTranscriptCursorError('Session transcript cursor payload is invalid');
  }
  if (!isRecord(parsed)) {
    throw new SessionTranscriptCursorError('Session transcript cursor payload must be an object');
  }
  const version = parsed.version;
  const revision = parsed.revision;
  const endIndex = parsed.endIndex;
  const limit = parsed.limit;
  const maximumBytes = parsed.maximumBytes;
  if (
    version !== CURSOR_VERSION ||
    typeof revision !== 'string' ||
    !REVISION_PATTERN.test(revision) ||
    typeof endIndex !== 'number' ||
    !Number.isSafeInteger(endIndex) ||
    endIndex <= 0 ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > SESSION_TRANSCRIPT_PAGE_MAX_ITEMS ||
    typeof maximumBytes !== 'number' ||
    !Number.isSafeInteger(maximumBytes) ||
    maximumBytes < SESSION_TRANSCRIPT_PAGE_MIN_BYTES ||
    maximumBytes > SESSION_TRANSCRIPT_PAGE_MAX_BYTES
  ) {
    throw new SessionTranscriptCursorError('Session transcript cursor fields are invalid');
  }
  return { version, revision, endIndex, limit, maximumBytes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
