import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer.js';
import { selectContextRingView } from './context-telemetry-selector.js';
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

  it('session/branch-switched hides occupancy until a matching Host snapshot arrives', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'context-telemetry/snapshot',
      snapshot: {
        sessionId: 's1',
        revision: 4,
        contextVersion: 1,
        contextBoundary: { activeLeafMessageId: 'a1' },
        responseEvidence: {
          currentRunHasResponse: false,
          historyHasDisplayableResponse: true,
        },
        phase: 'idle',
        occupancy: {
          kind: 'known',
          tokensUsed: 40_000,
          tokensLimit: 128_000,
          quality: 'measured',
          coverage: 'complete',
          basis: 'test',
          sampledAt: '2026-08-30T00:00:00.000Z',
        },
        updatedAt: '2026-08-30T00:00:00.000Z',
      },
      source: 'live',
    });
    expect(state.contextTelemetry.displayed?.occupancy).toMatchObject({ tokensUsed: 40_000 });
    state = chatUiReducer(state, { type: 'context-telemetry/capability', supported: true });
    expect(selectContextRingView({ telemetry: state.contextTelemetry, locale: 'en' }).visible).toBe(
      true,
    );

    state = chatUiReducer(state, {
      type: 'session/branch-switched',
      sessionId: 's1',
      messages: [userMessage('u1', 'kept')],
    });
    expect(state.contextTelemetry.displayed).toBeNull();
    expect(state.contextTelemetry.warmBySessionId.s1).toBeUndefined();
    expect(selectContextRingView({ telemetry: state.contextTelemetry, locale: 'en' }).visible).toBe(
      false,
    );
  });
});
