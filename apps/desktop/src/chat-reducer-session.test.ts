import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer.js';
import type { SessionTranscriptMessage } from '@piwin/contracts';

function userMessage(id: string, text: string): SessionTranscriptMessage {
  return {
    id,
    role: 'user',
    text,
    createdAt: '2026-08-30T00:00:00.000Z',
    status: 'done',
  };
}

describe('session/load-messages selection authority (T03)', () => {
  it('does not activate an old session when activeSessionId is null', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'old-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'old-session',
      messages: [userMessage('u1', 'hello from old')],
      contextUsage: {
        sessionId: 'old-session',
        tokensUsed: 8_000,
        updatedAt: '2026-08-30T00:00:00.000Z',
        source: 'assistant-usage',
      },
    });
    expect(state.activeSessionId).toBe('old-session');

    state = chatUiReducer(state, { type: 'session/clear-active' });
    expect(state.activeSessionId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.contextUsage).toBeNull();

    const afterLateResume = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'old-session',
      messages: [userMessage('u1', 'hello from old'), userMessage('u2', 'late')],
      contextUsage: {
        sessionId: 'old-session',
        tokensUsed: 9_999,
        updatedAt: '2026-08-30T00:01:00.000Z',
        source: 'assistant-usage',
      },
    });
    expect(afterLateResume).toBe(state);
    expect(afterLateResume.activeSessionId).toBeNull();
    expect(afterLateResume.messages).toEqual([]);
    expect(afterLateResume.contextUsage).toBeNull();
  });

  it('T04: load-messages for a previous session is ignored after A→B', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-a' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-b' });
    const ignored = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'session-a',
      messages: [userMessage('a1', 'from A')],
    });
    expect(ignored).toBe(state);
    expect(ignored.activeSessionId).toBe('session-b');
    expect(ignored.messages).toEqual([]);
  });
});
