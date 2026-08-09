import { describe, expect, it } from 'vitest';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  type SessionTranscriptMessage,
  type SessionTranscriptPageQuery,
} from '@piwin/contracts';
import {
  createSessionTranscriptPage,
  SessionTranscriptCursorError,
} from './session-transcript-page.js';

function message(index: number, text = `message-${index}`): SessionTranscriptMessage {
  return {
    id: `message-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text,
    createdAt: new Date(index * 1_000).toISOString(),
    status: 'done',
  };
}

function query(overrides: Partial<SessionTranscriptPageQuery> = {}): SessionTranscriptPageQuery {
  return {
    sessionId: 'session-1',
    limit: 16,
    maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
    ...overrides,
  };
}

describe('createSessionTranscriptPage', () => {
  it('returns the bounded tail and walks older pages without appending authority-sized arrays', () => {
    const messages = Array.from({ length: 10_000 }, (_, index) => message(index));
    const tail = createSessionTranscriptPage(messages, query());
    expect(tail.status).toBe('page');
    if (tail.status !== 'page') return;
    expect(tail.messages).toHaveLength(16);
    expect(tail.messages[0]?.id).toBe('message-9984');
    expect(tail.messages[15]?.id).toBe('message-9999');
    expect(tail.page.totalCount).toBe(10_000);
    expect(tail.page.olderCursor).toBeDefined();

    const olderCursor = tail.page.olderCursor;
    if (olderCursor === undefined) return;
    const older = createSessionTranscriptPage(messages, query({ beforeCursor: olderCursor }));
    expect(older.status).toBe('page');
    if (older.status !== 'page') return;
    expect(older.messages).toHaveLength(16);
    expect(older.messages[0]?.id).toBe('message-9968');
    expect(older.messages[15]?.id).toBe('message-9983');
  });

  it('stops before crossing the serialized page byte limit', () => {
    const messages = Array.from({ length: 8 }, (_, index) => message(index, 'x'.repeat(80_000)));
    const page = createSessionTranscriptPage(messages, query({ limit: 8, maximumBytes: 180_000 }));
    expect(page.status).toBe('page');
    if (page.status !== 'page') return;
    expect(page.messages).toHaveLength(2);
    expect(page.page.messageBytes).toBeLessThanOrEqual(180_000);
    expect(page.page.olderCursor).toBeDefined();
  });

  it('clips one oversized UI message while leaving the durable input unchanged', () => {
    const original = message(0, 'z'.repeat(600_000));
    const page = createSessionTranscriptPage(
      [original],
      query({ limit: 1, maximumBytes: 32 * 1024 }),
    );
    expect(page.status).toBe('page');
    if (page.status !== 'page') return;
    expect(page.page.messageBytes).toBeLessThanOrEqual(32 * 1024);
    expect(page.page.truncatedMessageIds).toEqual(['message-0']);
    expect(page.messages[0]?.text).toContain('full content remains on Host');
    expect(original.text).toHaveLength(600_000);
  });

  it('reports an older cursor stale after a transcript mutation', () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(index));
    const tail = createSessionTranscriptPage(messages, query());
    expect(tail.status).toBe('page');
    if (tail.status !== 'page' || tail.page.olderCursor === undefined) return;
    const changed = [...messages, message(40)];
    const stale = createSessionTranscriptPage(
      changed,
      query({ beforeCursor: tail.page.olderCursor }),
    );
    expect(stale.status).toBe('stale-cursor');
  });

  it('rejects invalid and query-mismatched cursors', () => {
    const messages = Array.from({ length: 40 }, (_, index) => message(index));
    expect(() =>
      createSessionTranscriptPage(messages, query({ beforeCursor: 'not/a/cursor' })),
    ).toThrow(SessionTranscriptCursorError);

    const tail = createSessionTranscriptPage(messages, query());
    expect(tail.status).toBe('page');
    if (tail.status !== 'page' || tail.page.olderCursor === undefined) return;
    const olderCursor = tail.page.olderCursor;
    expect(() =>
      createSessionTranscriptPage(messages, query({ limit: 8, beforeCursor: olderCursor })),
    ).toThrow('cursor limits do not match');
  });
});
