import { createHash } from 'node:crypto';
import type {
  AgentMessageRole,
  SessionOutlineNode,
  SessionOutlinePageData,
  SessionOutlinePageQuery,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { extractUserFacingBody } from './derive-default-name.js';

const PREVIEW_MAX_CHARS = 120;

/**
 * Build a linear message outline from product transcript.
 * Source of truth for chat body remains the full transcript messages.
 */
export function buildSessionOutline(
  messages: readonly SessionTranscriptMessage[],
): SessionOutlineNode[] {
  return messages.map((message) => ({
    id: message.id,
    role: message.role as AgentMessageRole,
    preview: buildPreview(
      message.role === 'user' ? extractUserFacingBody(message.text) : message.text,
    ),
    createdAt: message.createdAt,
  }));
}

/** Default size of the recent outline window returned by `session/resume`. */
export const DEFAULT_OUTLINE_RECENT_WINDOW = 40;
/** Hard ceiling for a single `session/outline-page` response. */
export const OUTLINE_PAGE_MAX_ITEMS = 100;
/** Minimum page size a client may request. */
export const OUTLINE_PAGE_MIN_ITEMS = 1;

const CURSOR_VERSION = 1;
const MAX_CURSOR_CHARS = 512;
const CURSOR_ALPHABET = /^[A-Za-z0-9_-]+$/;

/**
 * Bounded recent outline window (ADR 0040 §9).
 *
 * `session/resume` never returns the complete outline. It returns the newest
 * nodes up to `maxNodes` in chronological order; older outline data is
 * available through `session/outline-page`.
 */
export function buildSessionOutlineWindow(
  messages: readonly SessionTranscriptMessage[],
  maxNodes: number = DEFAULT_OUTLINE_RECENT_WINDOW,
): SessionOutlineNode[] {
  const outline = buildSessionOutline(messages);
  if (outline.length <= maxNodes) {
    return outline;
  }
  return outline.slice(outline.length - maxNodes);
}

/**
 * Build one bounded outline page (ADR 0040 §9).
 *
 * Omit `beforeCursor` for the newest page. `olderCursor` on the response
 * continues to the next older page. Cursors are revision-bound so an outline
 * that changed since the cursor was issued is rejected as stale instead of
 * silently mixing windows.
 */
export function buildSessionOutlinePage(
  messages: readonly SessionTranscriptMessage[],
  query: SessionOutlinePageQuery,
): SessionOutlinePageData {
  validateOutlinePageQuery(query);
  const outline = buildSessionOutline(messages);
  const revision = createOutlineRevision(outline, query.sessionId);
  const cursor =
    query.beforeCursor === undefined ? null : decodeOutlineCursor(query.beforeCursor);

  if (cursor !== null && cursor.revision !== revision) {
    return {
      sessionId: query.sessionId,
      nodes: [],
      hasOlder: false,
      recent: false,
    };
  }

  const endIndex = cursor?.endIndex ?? outline.length;
  if (cursor !== null && (endIndex <= 0 || endIndex > outline.length)) {
    return {
      sessionId: query.sessionId,
      nodes: [],
      hasOlder: false,
      recent: false,
    };
  }

  const startIndex = Math.max(0, endIndex - query.limit);
  const nodes = outline.slice(startIndex, endIndex);
  const hasOlder = startIndex > 0;
  const data: SessionOutlinePageData = {
    sessionId: query.sessionId,
    nodes,
    hasOlder,
    recent: cursor === null,
  };
  if (hasOlder) {
    data.olderCursor = encodeOutlineCursor({
      version: CURSOR_VERSION,
      revision,
      endIndex: startIndex,
    });
  }
  return data;
}

function validateOutlinePageQuery(query: SessionOutlinePageQuery): void {
  if (query.sessionId.length === 0 || query.sessionId.length > 256) {
    throw new RangeError('Session outline page requires a valid session id');
  }
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < OUTLINE_PAGE_MIN_ITEMS ||
    query.limit > OUTLINE_PAGE_MAX_ITEMS
  ) {
    throw new RangeError(
      `Session outline page limit must be between ${OUTLINE_PAGE_MIN_ITEMS} and ${OUTLINE_PAGE_MAX_ITEMS}`,
    );
  }
  if (query.beforeCursor !== undefined && query.beforeCursor.length > MAX_CURSOR_CHARS) {
    throw new RangeError('Session outline page cursor is too long');
  }
}

type OutlineCursorPayload = {
  version: number;
  revision: string;
  endIndex: number;
};

function createOutlineRevision(
  outline: readonly SessionOutlineNode[],
  sessionId: string,
): string {
  const hash = createHash('sha256');
  hash.update(sessionId);
  hash.update(`\u0000${outline.length}`);
  for (const node of outline) {
    hash.update('\u0000');
    hash.update(node.id);
  }
  return hash.digest('hex');
}

function encodeOutlineCursor(payload: OutlineCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeOutlineCursor(value: string): OutlineCursorPayload {
  if (value.length === 0 || value.length > MAX_CURSOR_CHARS || !CURSOR_ALPHABET.test(value)) {
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
  const version = record.version;
  const revision = record.revision;
  const endIndex = record.endIndex;
  if (
    version !== CURSOR_VERSION ||
    typeof revision !== 'string' ||
    !/^[a-f0-9]{64}$/.test(revision) ||
    typeof endIndex !== 'number' ||
    !Number.isSafeInteger(endIndex) ||
    endIndex <= 0
  ) {
    throw new RangeError('Session outline page cursor fields are invalid');
  }
  return { version, revision, endIndex };
}

function buildPreview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= PREVIEW_MAX_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}
