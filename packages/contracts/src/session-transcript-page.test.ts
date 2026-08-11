import { describe, expect, it } from 'vitest';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MAX_BYTES,
  SESSION_TRANSCRIPT_PAGE_MAX_ITEMS,
  SESSION_TRANSCRIPT_PAGE_MIN_BYTES,
  type SessionTranscriptPageData,
  type SessionTranscriptPageQuery,
} from './session-transcript-page.js';

describe('session transcript page contracts', () => {
  it('round-trips a bounded older-page request without exposing cursor internals', () => {
    const query: SessionTranscriptPageQuery = {
      sessionId: 'session-1',
      limit: 50,
      maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
      beforeCursor: 'opaque-before',
    };
    const data: SessionTranscriptPageData = {
      status: 'page',
      messages: [],
      page: {
        revision: 'a'.repeat(64),
        totalCount: 40,
        startIndex: 8,
        endIndex: 24,
        messageBytes: 2,
        olderCursor: 'opaque-older',
      },
    };

    expect(JSON.parse(JSON.stringify({ query, data }))).toEqual({ query, data });
    expect(SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS).toBe(50);
    expect(SESSION_TRANSCRIPT_PAGE_MAX_ITEMS).toBe(50);
    expect(SESSION_TRANSCRIPT_PAGE_MIN_BYTES).toBe(16 * 1024);
    expect(SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES).toBe(256 * 1024);
    expect(SESSION_TRANSCRIPT_PAGE_MAX_BYTES).toBe(512 * 1024);
  });

  it('represents stale transcript recovery explicitly', () => {
    const data: SessionTranscriptPageData = {
      status: 'stale-cursor',
      currentRevision: 'b'.repeat(64),
    };
    expect(data.status).toBe('stale-cursor');
  });
});
