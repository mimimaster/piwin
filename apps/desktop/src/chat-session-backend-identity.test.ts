import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import { mapListedSessionItems, sessionUpdateFromIndexPush } from './remote-session-hydrate';

const backend = { agentId: 'grok' };
const scope = { kind: 'general' as const };
const remoteRow = { sessionId: 'grok-session', name: 'Research', scope: 'general', backend };

describe('session backend identity through remote hydration and activation', () => {
  it('hydrates the agent prefix on cold load and keeps it after a name-only update', () => {
    const mapped = mapListedSessionItems({ sessions: [remoteRow] });
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/hydrate-scope', scope, sessions: mapped.sessions, totalCount: 1, truncated: false,
    });
    expect(state.generalSessions[0]?.backend).toEqual(backend);
    state = chatUiReducer(state, sessionUpdateFromIndexPush('updated', { id: 'grok-session', name: 'New title' }));
    expect(state.generalSessions[0]).toMatchObject({ name: 'New title', backend });
    expect(state.sessionEntitiesById['grok-session']?.backend).toEqual(backend);
  });

  it('preserves an early creation push when the named draft is inserted', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/update', session: { id: 'grok-session', name: '', scope, backend },
    });
    state = chatUiReducer(state, { type: 'session/add', sessionId: 'grok-session', name: 'Research', scope });
    expect(state.generalSessions[0]?.backend).toEqual(backend);
    expect(state.sessions[0]?.backend).toEqual(backend);
  });

  it('seeds the prefix before any catalog or index push arrives', () => {
    const state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/add', sessionId: 'grok-session', name: 'Research', scope, backend,
    });
    expect(state.generalSessions[0]?.backend).toEqual(backend);
    expect(state.sessionEntitiesById['grok-session']?.backend).toEqual(backend);
    expect(state.backendCapabilitiesBySession['grok-session']).toBeUndefined();
  });
});
