import { describe, expect, it } from 'vitest';
import { SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES } from '@piwin/contracts';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { createMockSessionTranscriptPage } from './mock-session-transcript-page';

function transcript(length: number): SessionTranscriptMessage[] {
  return Array.from({ length }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `message ${index}`,
    createdAt: new Date(index * 1_000).toISOString(),
    status: 'done',
  }));
}

describe('browser mock transcript pages', () => {
  it('matches tail/older cursor semantics and stale recovery', () => {
    const messages = transcript(40);
    const query = {
      sessionId: 'mock-session',
      limit: 16,
      maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
    } as const;
    const tail = createMockSessionTranscriptPage(messages, query);
    expect(tail.status).toBe('page');
    if (tail.status !== 'page' || tail.page.olderCursor === undefined) return;
    expect(tail.messages[0]?.id).toBe('m-24');
    const olderCursor = tail.page.olderCursor;
    const older = createMockSessionTranscriptPage(messages, {
      ...query,
      beforeCursor: olderCursor,
    });
    expect(older.status).toBe('page');
    if (older.status !== 'page') return;
    expect(older.messages[0]?.id).toBe('m-8');

    const changedLimits = createMockSessionTranscriptPage(messages, {
      ...query,
      limit: 8,
      beforeCursor: olderCursor,
    });
    expect(changedLimits).toEqual({
      status: 'stale-cursor',
      currentRevision: tail.page.revision,
    });

    const stale = createMockSessionTranscriptPage([...messages, ...transcript(1)], {
      ...query,
      beforeCursor: olderCursor,
    });
    expect(stale.status).toBe('stale-cursor');
  });
});
