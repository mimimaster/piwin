import { describe, expect, it } from 'vitest';
import {
  chatUiReducer,
  createInitialChatUiState,
} from './chat-reducer';

describe('chatUiReducer transcript window', () => {
  it('prepends an older transcript page without replacing the active tail', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'paged-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'm3',
          role: 'user',
          text: 'three',
          createdAt: '2026-08-09T00:00:03.000Z',
          status: 'done',
        },
        {
          id: 'm4',
          role: 'assistant',
          text: 'four',
          createdAt: '2026-08-09T00:00:04.000Z',
          status: 'done',
        },
      ],
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 4,
        startIndex: 2,
        endIndex: 4,
        messageBytes: 256,
        olderCursor: 'older-1',
      },
    });
    state = chatUiReducer(state, {
      type: 'session/prepend-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'm1',
          role: 'user',
          text: 'one',
          createdAt: '2026-08-09T00:00:01.000Z',
          status: 'done',
        },
        {
          id: 'm2',
          role: 'assistant',
          text: 'two',
          createdAt: '2026-08-09T00:00:02.000Z',
          status: 'done',
        },
      ],
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 4,
        startIndex: 0,
        endIndex: 2,
        messageBytes: 256,
      },
    });

    expect(state.messages.map((message) => message.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(state.transcriptWindow).toMatchObject({
      revision: 'a'.repeat(64),
      totalCount: 4,
      cacheLimitReached: false,
    });
    expect(state.transcriptWindow?.olderCursor).toBeUndefined();
  });

  it('keeps the live tail separate while a bounded history view is open', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'history-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'history-session',
      messages: [
        {
          id: 'tail-user',
          role: 'user',
          text: 'latest request',
          createdAt: '2026-08-12T00:10:00.000Z',
          status: 'done',
        },
        {
          id: 'tail-assistant',
          role: 'assistant',
          text: 'latest answer',
          createdAt: '2026-08-12T00:10:01.000Z',
          status: 'done',
        },
      ],
    });
    state = chatUiReducer(state, {
      type: 'session/seek-messages',
      sessionId: 'history-session',
      epoch: state.userMessageIndexEpoch,
      messages: [
        {
          id: 'old-user',
          role: 'user',
          text: 'old request',
          createdAt: '2026-08-01T00:00:00.000Z',
          status: 'done',
        },
        {
          id: 'old-assistant',
          role: 'assistant',
          text: 'old answer',
          createdAt: '2026-08-01T00:00:01.000Z',
          status: 'done',
        },
      ],
      window: {
        revision: 'history-revision',
        totalCount: 200,
        startIndex: 20,
        endIndex: 22,
        messageBytes: 256,
        anchorMessageId: 'old-user',
        anchorOffset: 0,
      },
    });

    expect(state.messages.map((message) => message.id)).toEqual(['tail-user', 'tail-assistant']);
    expect(state.historyView?.messages.map((message) => message.id)).toEqual([
      'old-user',
      'old-assistant',
    ]);

    state = chatUiReducer(state, {
      type: 'transcript/append',
      sessionId: 'history-session',
      message: {
        id: 'new-live-message',
        role: 'assistant',
        text: 'arrived while reading history',
        createdAt: '2026-08-12T00:10:02.000Z',
        status: 'done',
      },
    });

    expect(state.messages.at(-1)?.id).toBe('new-live-message');
    expect(state.historyView?.messages.at(-1)?.id).toBe('old-assistant');

    state = chatUiReducer(state, {
      type: 'session/return-to-live',
      sessionId: 'history-session',
    });
    expect(state.historyView).toBeNull();
    expect(state.messages.at(-1)?.id).toBe('new-live-message');
  });

  it('rejects a user-message index response from an invalidated request epoch', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'index-session' });
    const staleEpoch = state.userMessageIndexEpoch;
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'new request',
      clientMessageId: 'new-request',
    });
    state = chatUiReducer(state, {
      type: 'session/user-message-index',
      sessionId: 'index-session',
      epoch: staleEpoch,
      index: {
        sessionId: 'index-session',
        revision: 'stale-index',
        totalUserMessages: 0,
        mode: 'exact',
        anchors: [],
        anchorBytes: 2,
      },
    });

    expect(state.userMessageIndex).toBeNull();
    expect(state.userMessageIndexEpoch).toBeGreaterThan(staleEpoch);
  });

  it('bounds messages appended during a long-lived renderer session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'paged-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: Array.from({ length: 160 }, (_, index) => ({
        id: `m-${index}`,
        role: 'assistant' as const,
        text: `message ${index}`,
        createdAt: `2026-08-09T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
        status: 'done' as const,
      })),
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 200,
        startIndex: 40,
        endIndex: 200,
        messageBytes: 16_000,
        olderCursor: 'older-1',
      },
    });

    state = chatUiReducer(state, {
      type: 'transcript/append',
      sessionId: 'paged-session',
      message: {
        id: 'm-160',
        role: 'assistant',
        text: 'new live-session message',
        createdAt: '2026-08-09T00:03:00.000Z',
        status: 'done',
      },
    });

    expect(state.messages).toHaveLength(160);
    expect(state.messages[0]?.id).toBe('m-1');
    expect(state.messages.at(-1)?.id).toBe('m-160');
    expect(state.transcriptWindow?.cacheLimitReached).toBe(true);
    expect(state.transcriptWindow?.olderCursor).toBeUndefined();
  });

  it('preserves an active partial turn when a stale cursor refreshes the tail', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'paged-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'durable-old',
          role: 'assistant',
          text: 'old tail',
          createdAt: '2026-08-09T00:00:00.000Z',
          status: 'done',
        },
      ],
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 2,
        startIndex: 1,
        endIndex: 2,
        messageBytes: 128,
        olderCursor: 'stale-older',
      },
    });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'current prompt',
      clientMessageId: 'live-user',
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 'paged-session',
      event: { type: 'message/start', messageId: 'live-assistant', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 'paged-session',
      event: {
        type: 'message/text_delta',
        messageId: 'live-assistant',
        delta: 'local partial',
      },
    });

    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'durable-new',
          role: 'assistant',
          text: 'new durable tail',
          createdAt: '2026-08-09T00:01:00.000Z',
          status: 'done',
        },
        {
          id: 'live-assistant',
          role: 'assistant',
          text: 'older persisted prefix',
          createdAt: '2026-08-09T00:02:00.000Z',
          status: 'streaming',
        },
      ],
      transcriptPage: {
        revision: 'b'.repeat(64),
        totalCount: 3,
        startIndex: 1,
        endIndex: 3,
        messageBytes: 256,
      },
      preserveActiveTail: true,
    });

    expect(state.messages.map((message) => message.id)).toEqual([
      'durable-new',
      'live-user',
      'live-assistant',
    ]);
    expect(state.messages.find((message) => message.id === 'live-assistant')?.text).toBe(
      'local partial',
    );
    expect(state.messages.find((message) => message.id === 'live-assistant')?.status).toBe(
      'streaming',
    );
    expect(state.streaming).toBe(true);
    expect(state.runPhase).toBe('streaming');
    expect(state.transcriptWindow?.revision).toBe('b'.repeat(64));
  });

  it('ignores an older transcript page from a different revision', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'paged-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: [],
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 2,
        startIndex: 0,
        endIndex: 0,
        messageBytes: 2,
      },
    });
    const unchanged = chatUiReducer(state, {
      type: 'session/prepend-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'stale',
          role: 'assistant',
          text: 'stale',
          createdAt: '2026-08-09T00:00:00.000Z',
          status: 'done',
        },
      ],
      transcriptPage: {
        revision: 'b'.repeat(64),
        totalCount: 2,
        startIndex: 0,
        endIndex: 1,
        messageBytes: 128,
      },
    });
    expect(unchanged).toBe(state);
  });

  it('session/remove drops session and clears active transcript when active', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/hydrate',
      sessions: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'a' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'a',
      messages: [
        {
          id: 'm1',
          role: 'user',
          text: 'hi',
          createdAt: '2026-07-21T00:00:00.000Z',
          status: 'done',
        },
      ],
    });
    state = chatUiReducer(state, { type: 'session/remove', sessionId: 'a' });
    expect(state.sessions.map((item) => item.id)).toEqual(['b']);
    // Do not auto-select another session after removing the active one.
    expect(state.activeSessionId).toBeNull();
    expect(state.messages).toEqual([]);
  });

  it('session/remove drops the working marker for that session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'a' });
    state = chatUiReducer(state, { type: 'user/send', text: 'go' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    expect(state.workingSessionIds).toEqual({ a: true });
    state = chatUiReducer(state, { type: 'session/remove', sessionId: 'a' });
    expect(state.workingSessionIds).toEqual({});
  });
});
