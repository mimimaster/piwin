import { createHash } from 'node:crypto';
import {
  SESSION_LIST_PAGE_MAX_ITEMS,
  type SessionIndexRecord,
  type SessionListPageInfo,
  type SessionListPageQuery,
  type SessionListPageResult,
} from '@piwin/contracts';
import { filterListableSessions } from './session-display-name.js';
import { orderSessionIndexRecords } from './session-index-projection.js';

const CURSOR_VERSION = 1;
const MAX_CURSOR_CHARS = 512;
const CURSOR_ALPHABET = /^[A-Za-z0-9_-]+$/;
const REVISION_PATTERN = /^[a-f0-9]{64}$/;

type SessionIndexCursorPayload = {
  version: number;
  revision: string;
  offset: number;
  limit: number;
};

export class SessionIndexCursorError extends Error {
  public readonly name = 'SessionIndexCursorError';
}

/** Build one query-bound page after listability, lifecycle, and order policy. */
export function createSessionIndexPage(
  records: readonly SessionIndexRecord[],
  query: SessionListPageQuery,
): SessionListPageResult<SessionIndexRecord> {
  validateLimit(query.limit);
  const lifecycleRecords = records.filter((record) =>
    query.lifecycle === 'archived' ? record.isArchived === true : record.isArchived !== true,
  );
  const orderedRecords = orderSessionIndexRecords(
    filterListableSessions(lifecycleRecords),
    query.order,
  );
  const revision = createProjectionRevision(orderedRecords, query);
  const cursor = query.cursor === undefined ? null : decodeCursor(query.cursor);

  if (cursor !== null && cursor.revision !== revision) {
    return { status: 'stale-cursor', currentRevision: revision };
  }
  if (cursor !== null && cursor.limit !== query.limit) {
    throw new SessionIndexCursorError('Session list cursor limit does not match the query');
  }

  const anchorIndex =
    cursor === null && query.anchorSessionId !== undefined
      ? orderedRecords.findIndex((record) => record.id === query.anchorSessionId)
      : -1;
  const offset =
    cursor?.offset ?? (anchorIndex >= 0 ? Math.floor(anchorIndex / query.limit) * query.limit : 0);
  if (offset % query.limit !== 0) {
    throw new SessionIndexCursorError('Session list cursor offset is not page-aligned');
  }
  if (offset > 0 && offset >= orderedRecords.length) {
    throw new SessionIndexCursorError('Session list cursor offset is outside the collection');
  }

  const totalCount = orderedRecords.length;
  const pageCount = totalCount === 0 ? 0 : Math.ceil(totalCount / query.limit);
  const pageIndex = totalCount === 0 ? 0 : Math.floor(offset / query.limit);
  const sessions = orderedRecords.slice(offset, offset + query.limit);
  const page: SessionListPageInfo = {
    revision,
    pageIndex,
    pageCount,
    totalCount,
  };

  if (offset > 0) {
    page.previousCursor = encodeCursor({
      version: CURSOR_VERSION,
      revision,
      offset: Math.max(0, offset - query.limit),
      limit: query.limit,
    });
  }
  if (offset + sessions.length < totalCount) {
    page.nextCursor = encodeCursor({
      version: CURSOR_VERSION,
      revision,
      offset: offset + query.limit,
      limit: query.limit,
    });
  }

  return { status: 'page', sessions, page };
}

function createProjectionRevision(
  records: readonly SessionIndexRecord[],
  query: SessionListPageQuery,
): string {
  const queryIdentity = {
    scope: query.scope,
    lifecycle: query.lifecycle,
    order: query.order,
  };
  return createHash('sha256')
    .update(JSON.stringify({ query: queryIdentity, records }))
    .digest('hex');
}

function validateLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > SESSION_LIST_PAGE_MAX_ITEMS) {
    throw new RangeError(
      `Session list page limit must be between 1 and ${SESSION_LIST_PAGE_MAX_ITEMS}`,
    );
  }
}

function encodeCursor(payload: SessionIndexCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(value: string): SessionIndexCursorPayload {
  if (value.length === 0 || value.length > MAX_CURSOR_CHARS || !CURSOR_ALPHABET.test(value)) {
    throw new SessionIndexCursorError('Session list cursor encoding is invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new SessionIndexCursorError('Session list cursor payload is invalid');
  }
  if (!isRecord(parsed)) {
    throw new SessionIndexCursorError('Session list cursor payload must be an object');
  }

  const version = parsed.version;
  const revision = parsed.revision;
  const offset = parsed.offset;
  const limit = parsed.limit;
  if (
    version !== CURSOR_VERSION ||
    typeof revision !== 'string' ||
    !REVISION_PATTERN.test(revision) ||
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit <= 0 ||
    limit > SESSION_LIST_PAGE_MAX_ITEMS
  ) {
    throw new SessionIndexCursorError('Session list cursor fields are invalid');
  }
  return { version, revision, offset, limit };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
