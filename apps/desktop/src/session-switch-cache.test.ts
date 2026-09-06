import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer.js';

function userMessage(id: string, text: string): SessionTranscriptMessage {
  return {
    id,
    role: 'user',
    text,
    createdAt: '2026-09-06T00:00:00.000Z',
    status: 'done',
  };
}

function loadOwnedSession(
  sessionId: string,
  messageId: string,
  text: string,
  state = createInitialChatUiState(),
) {
  let next = chatUiReducer(state, { type: 'session/set', sessionId });
  return chatUiReducer(next, {
    type: 'session/load-messages',
    sessionId,
    messages: [userMessage(messageId, text)],
  });
}

describe('session switch cache ownership', () => {
  it('does not store session A rows under session B during A→B→C cold clicks', () => {
    let state = loadOwnedSession('session-a', 'message-a', 'from A');

    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 'session-b',
      awaitTranscript: true,
    });
    expect(state.activeSessionId).toBe('session-b');
    expect(state.transcriptOwnerSessionId).toBe('session-b');
    expect(state.messages.map((message) => message.id)).toEqual([]);
    expect(state.warmSessionCache.byId['session-a']?.messages[0]?.id).toBe('message-a');
    expect(state.warmSessionCache.byId['session-b']).toBeUndefined();

    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 'session-c',
      awaitTranscript: true,
    });
    expect(state.activeSessionId).toBe('session-c');
    expect(state.warmSessionCache.byId['session-b']).toBeUndefined();
    expect(state.warmSessionCache.byId['session-a']?.messages[0]?.id).toBe('message-a');
    expect(state.messages.map((message) => message.id)).toEqual([]);
  });

  it('stashes the leaving transcript before project/set so A can warm-hit later', () => {
    let state = loadOwnedSession('session-a', 'message-a', 'from A');

    state = chatUiReducer(state, {
      type: 'project/set',
      path: '/other-project',
      trusted: true,
    });
    expect(state.activeSessionId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.warmSessionCache.byId['session-a']?.messages[0]?.id).toBe('message-a');

    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 'session-b',
      awaitTranscript: true,
    });
    expect(state.warmSessionCache.byId['session-a']?.messages[0]?.id).toBe('message-a');
    expect(state.messages).toEqual([]);

    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 'session-a',
      awaitTranscript: true,
    });
    expect(state.messages[0]?.id).toBe('message-a');
    expect(state.transcriptOwnerSessionId).toBe('session-a');
    expect(state.awaitingTranscript).toBe(true);
  });

  it('keeps an already-selected session when project/set asks to preserve it', () => {
    let state = loadOwnedSession('session-b', 'message-b', 'from B');
    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 'session-b',
      awaitTranscript: true,
    });

    state = chatUiReducer(state, {
      type: 'project/set',
      path: '/project-b',
      trusted: true,
      keepActiveSession: true,
    });

    expect(state.activeScope).toEqual({ kind: 'project', projectPath: '/project-b' });
    expect(state.projectTrusted).toBe(true);
    expect(state.activeSessionId).toBe('session-b');
    expect(state.transcriptOwnerSessionId).toBe('session-b');
    expect(state.messages[0]?.id).toBe('message-b');
    expect(state.awaitingTranscript).toBe(true);
  });

  it('stashes owned rows on project/clear and scope/set', () => {
    const owned = loadOwnedSession('session-a', 'message-a', 'from A');

    const afterClear = chatUiReducer(owned, { type: 'project/clear' });
    expect(afterClear.warmSessionCache.byId['session-a']?.messages[0]?.id).toBe('message-a');

    const afterScope = chatUiReducer(owned, {
      type: 'scope/set',
      scope: { kind: 'project', projectPath: '/p' },
    });
    expect(afterScope.warmSessionCache.byId['session-a']?.messages[0]?.id).toBe('message-a');
  });

  it('reuses unchanged warm rows when resume returns the same transcript', () => {
    let state = loadOwnedSession('session-a', 'message-a', 'from A');
    const painted = state.messages[0];
    expect(painted).toBeDefined();

    state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-b' });
    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 'session-a',
      awaitTranscript: true,
    });
    const warmRow = state.messages[0];
    expect(warmRow?.id).toBe('message-a');

    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'session-a',
      messages: [userMessage('message-a', 'from A')],
    });
    expect(state.messages[0]).toBe(warmRow);
  });
});
