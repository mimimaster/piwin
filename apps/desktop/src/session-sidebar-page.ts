import type { SessionListPageInfo } from '@piwin/contracts';

/** Fixed renderer budgets; complete session collections remain Host-owned. */
export const PROJECT_SESSION_PAGE_SIZE = 6;
export const GENERAL_SESSION_PAGE_SIZE = 12;

export type SessionSidebarPage<T> = {
  items: T[];
  pageIndex: number;
  pageCount: number;
  totalCount: number;
};

/**
 * Pair a Host-owned page position with the one bounded item array retained by
 * Desktop. Unlike the local fallback selector, this must never slice again:
 * the items already represent the globally filtered and ordered Host page.
 */
export function projectHostSessionPage<T>(
  sessions: readonly T[],
  page: SessionListPageInfo,
): SessionSidebarPage<T> {
  return {
    items: [...sessions],
    pageIndex: page.pageIndex,
    pageCount: page.pageCount,
    totalCount: page.totalCount,
  };
}

/**
 * Select one fixed-size sidebar page. When navigation has not chosen a page,
 * the active session determines it so restoring an old session never expands
 * the complete collection merely to keep that row visible.
 */
export function selectSessionSidebarPage<T extends { id: string }>(
  sessions: readonly T[],
  pageSize: number,
  requestedPageIndex: number | null,
  activeSessionId: string | null,
): SessionSidebarPage<T> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new RangeError('Session sidebar page size must be a positive integer');
  }
  if (sessions.length === 0) {
    return { items: [], pageIndex: 0, pageCount: 0, totalCount: 0 };
  }

  const pageCount = Math.ceil(sessions.length / pageSize);
  const activeSessionIndex =
    activeSessionId === null ? -1 : sessions.findIndex((session) => session.id === activeSessionId);
  const preferredPageIndex =
    requestedPageIndex === null && activeSessionIndex >= 0
      ? Math.floor(activeSessionIndex / pageSize)
      : (requestedPageIndex ?? 0);
  const finitePageIndex = Number.isFinite(preferredPageIndex) ? Math.floor(preferredPageIndex) : 0;
  const pageIndex = Math.min(Math.max(finitePageIndex, 0), pageCount - 1);
  const firstItemIndex = pageIndex * pageSize;

  return {
    items: sessions.slice(firstItemIndex, firstItemIndex + pageSize),
    pageIndex,
    pageCount,
    totalCount: sessions.length,
  };
}
