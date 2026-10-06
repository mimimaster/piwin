import { describe, expect, it } from 'vitest';
import { createInitialChatUiState } from './chat-reducer.js';
import { createPiSessionCapabilities } from '@piwin/contracts';
import {
  isGoalExtensionEnabled,
  listSessionUserPrompts,
  resolveComposerLayoutMode,
  resolveActiveComposerAgentId,
  resolveActiveComposerBackendBinding,
} from './composer-dock-assembly.js';

describe('listSessionUserPrompts', () => {
  it('returns newest-first unique user texts, capped at 10', () => {
    const messages = [
      { role: 'user', text: 'first' },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: 'second' },
      { role: 'user', text: '  ' },
      { role: 'user', text: 'second' },
      { role: 'user', text: 'third' },
    ];
    expect(listSessionUserPrompts(messages)).toEqual(['third', 'second', 'first']);
  });
});

describe('resolveComposerLayoutMode', () => {
  it('centers only an empty live transcript', () => {
    expect(
      resolveComposerLayoutMode({ messageCount: 0, awaitingTranscript: false }),
    ).toBe('centered');
    expect(
      resolveComposerLayoutMode({ messageCount: 0, awaitingTranscript: true }),
    ).toBe('docked');
    expect(
      resolveComposerLayoutMode({ messageCount: 1, awaitingTranscript: false }),
    ).toBe('docked');
  });
});

describe('isGoalExtensionEnabled', () => {
  it('treats a missing list as enabled and matches goal case-insensitively', () => {
    expect(isGoalExtensionEnabled(undefined)).toBe(true);
    expect(isGoalExtensionEnabled([])).toBe(true);
    expect(isGoalExtensionEnabled(['Goal'])).toBe(false);
    expect(isGoalExtensionEnabled(['browser'])).toBe(true);
  });
});


describe('resolveActiveComposerAgentId', () => {
  it('retains the normalized binding before a stale sidebar row', () => {
    const state = createInitialChatUiState();
    state.activeSessionId = 'external';
    const binding = { agentId: 'grok' };
    state.sessionEntitiesById['external'] = { id: 'external', name: 'Build', backend: binding };
    state.sessions = [{ id: 'external', name: 'Stale', backend: { agentId: 'other-agent' } }];
    expect(resolveActiveComposerBackendBinding(state)).toBe(binding);
    state.activeSessionId = null;
    expect(resolveActiveComposerBackendBinding(state)).toBeUndefined();
  });

  it('uses a durable binding before capabilities or a model catalog arrive', () => {
    const state = createInitialChatUiState();
    state.activeSessionId = 'external';
    state.sessions = [{ id: 'external', name: 'Build DMG', backend: { agentId: 'grok' } }];
    expect(resolveActiveComposerAgentId(state)).toBe('grok');
  });

  it('keeps the external binding after the active row leaves the sidebar page', () => {
    const state = createInitialChatUiState();
    state.activeSessionId = 'external';
    state.sessionEntitiesById['external'] = {
      id: 'external', name: 'Build DMG', backend: { agentId: 'grok' },
    };
    expect(resolveActiveComposerAgentId(state)).toBe('grok');
    state.activeSessionId = 'native';
    expect(resolveActiveComposerAgentId(state)).toBe('pi');
  });

  it('resolves an external row retained only in another project list', () => {
    const state = createInitialChatUiState();
    state.activeSessionId = 'external';
    state.projectSessionsByPath['/project'] = [
      { id: 'external', name: 'Build DMG', backend: { agentId: 'grok' } },
    ];
    expect(resolveActiveComposerAgentId(state)).toBe('grok');
  });

  it('uses Host capabilities when the session row has not arrived', () => {
    const state = createInitialChatUiState();
    state.activeSessionId = 'external';
    state.backendCapabilitiesBySession['external'] = { ...createPiSessionCapabilities(), agentId: 'grok' };
    expect(resolveActiveComposerAgentId(state)).toBe('grok');
  });

  it('leaves a new draft to its own agent selection', () => {
    expect(resolveActiveComposerAgentId(createInitialChatUiState())).toBeUndefined();
  });
});
