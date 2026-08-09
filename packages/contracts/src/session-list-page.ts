import type { SessionScope, SessionSummary } from './host.js';

export const SESSION_LIST_PAGE_MAX_ITEMS = 50;

export type SessionListOrder = 'updated' | 'alphabetical';
export type SessionListLifecycle = 'active' | 'archived';

/** Host-owned query for one deterministic session-index page. */
export type SessionListPageQuery = {
  scope: SessionScope;
  lifecycle: SessionListLifecycle;
  order: SessionListOrder;
  limit: number;
  /**
   * On a cursorless request, start at the page containing this session when it
   * belongs to the filtered projection. This lets shells restore an older
   * active session without walking every preceding page. Ignored when a
   * cursor is present.
   */
  anchorSessionId?: string;
  /** Opaque, query-bound continuation returned by an earlier page. */
  cursor?: string;
};

export type SessionListPageInfo = {
  /** Opaque revision of the filtered, ordered Host projection. */
  revision: string;
  pageIndex: number;
  pageCount: number;
  totalCount: number;
  previousCursor?: string;
  nextCursor?: string;
};

/**
 * A stale cursor is a normal concurrent-index outcome, not a transport error.
 * Clients restart from the first page using the same query.
 */
export type SessionListPageResult<Session> =
  | {
      status: 'page';
      sessions: Session[];
      page: SessionListPageInfo;
    }
  | {
      status: 'stale-cursor';
      currentRevision: string;
    };

export type SessionListPageData = SessionListPageResult<SessionSummary>;
