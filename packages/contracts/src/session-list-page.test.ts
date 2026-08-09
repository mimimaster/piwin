import { describe, expect, it } from 'vitest';
import {
  SESSION_LIST_PAGE_MAX_ITEMS,
  type SessionListPageData,
  type SessionListPageQuery,
} from './session-list-page.js';

describe('session list page contracts', () => {
  it('round-trips a query and page without exposing cursor internals', () => {
    const query: SessionListPageQuery = {
      scope: { kind: 'general' },
      lifecycle: 'active',
      order: 'updated',
      limit: 12,
      cursor: 'opaque-cursor',
    };
    const data: SessionListPageData = {
      status: 'page',
      sessions: [],
      page: {
        revision: 'a'.repeat(64),
        pageIndex: 1,
        pageCount: 4,
        totalCount: 40,
        previousCursor: 'opaque-previous',
        nextCursor: 'opaque-next',
      },
    };

    expect(JSON.parse(JSON.stringify({ query, data }))).toEqual({ query, data });
    expect(SESSION_LIST_PAGE_MAX_ITEMS).toBe(50);
  });

  it('represents stale cursor recovery explicitly', () => {
    const data: SessionListPageData = {
      status: 'stale-cursor',
      currentRevision: 'b'.repeat(64),
    };
    expect(data.status).toBe('stale-cursor');
  });
});
