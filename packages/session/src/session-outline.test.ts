import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import {
  buildSessionOutline,
  buildSessionOutlineWindow,
  buildSessionOutlinePage,
  DEFAULT_OUTLINE_RECENT_WINDOW,
} from './session-outline.js';

function makeMessage(id: string, role: 'user' | 'assistant', text: string): SessionTranscriptMessage {
  return {
    id,
    role,
    text,
    createdAt: new Date().toISOString(),
    status: 'done',
  };
}

describe('session outline', () => {
  it('returns the complete outline for small transcripts', () => {
    const messages = [makeMessage('m1', 'user', 'hello'), makeMessage('m2', 'assistant', 'hi')];
    expect(buildSessionOutlineWindow(messages)).toEqual(buildSessionOutline(messages));
  });

  it('returns only the bounded recent window for large transcripts (ADR 0040 §9)', () => {
    const messages = Array.from({ length: DEFAULT_OUTLINE_RECENT_WINDOW + 25 }, (_, index) =>
      makeMessage(`m${index}`, index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`),
    );
    const window = buildSessionOutlineWindow(messages);
    expect(window).toHaveLength(DEFAULT_OUTLINE_RECENT_WINDOW);
    expect(window[0]?.id).toBe(`m${messages.length - DEFAULT_OUTLINE_RECENT_WINDOW}`);
    expect(window.at(-1)?.id).toBe(`m${messages.length - 1}`);
  });

  it('pages the newest outline page and walks older pages with cursors', () => {
    const messages = Array.from({ length: 30 }, (_, index) =>
      makeMessage(`m${index}`, index % 2 === 0 ? 'user' : 'assistant', `turn ${index}`),
    );

    const newest = buildSessionOutlinePage(messages, { sessionId: 's1', limit: 10 });
    expect(newest.recent).toBe(true);
    expect(newest.hasOlder).toBe(true);
    expect(newest.nodes.map((node) => node.id)).toEqual([
      'm20',
      'm21',
      'm22',
      'm23',
      'm24',
      'm25',
      'm26',
      'm27',
      'm28',
      'm29',
    ]);
    if (newest.olderCursor === undefined) {
      throw new Error('expected an older cursor for the newest page');
    }

    const older = buildSessionOutlinePage(messages, {
      sessionId: 's1',
      limit: 10,
      beforeCursor: newest.olderCursor,
    });
    expect(older.recent).toBe(false);
    expect(older.nodes.map((node) => node.id)).toEqual([
      'm10',
      'm11',
      'm12',
      'm13',
      'm14',
      'm15',
      'm16',
      'm17',
      'm18',
      'm19',
    ]);
    if (older.olderCursor === undefined) {
      throw new Error('expected an older cursor for the middle page');
    }

    const oldest = buildSessionOutlinePage(messages, {
      sessionId: 's1',
      limit: 10,
      beforeCursor: older.olderCursor,
    });
    expect(oldest.nodes.map((node) => node.id)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    expect(oldest.hasOlder).toBe(false);
  });

  it('rejects a stale cursor with an empty page instead of mixing windows', () => {
    const messagesA = [makeMessage('m1', 'user', 'a'), makeMessage('m2', 'assistant', 'b')];
    const messagesB = [makeMessage('m1', 'user', 'a'), makeMessage('m2', 'assistant', 'b'), makeMessage('m3', 'user', 'c')];

    const page = buildSessionOutlinePage(messagesA, { sessionId: 's1', limit: 1 });
    if (page.olderCursor === undefined) {
      throw new Error('expected an older cursor');
    }
    const stale = buildSessionOutlinePage(messagesB, {
      sessionId: 's1',
      limit: 1,
      beforeCursor: page.olderCursor,
    });
    expect(stale.nodes).toEqual([]);
    expect(stale.hasOlder).toBe(false);
  });

  it('clamps invalid page limits', () => {
    expect(() =>
      buildSessionOutlinePage([], { sessionId: 's1', limit: 0 }),
    ).toThrow(RangeError);
    expect(() =>
      buildSessionOutlinePage([], { sessionId: 's1', limit: 1000 }),
    ).toThrow(RangeError);
  });
});
