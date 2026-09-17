import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import { makeRun } from './chat-reducer-test-harness';
import type { PermissionPromptUi } from './chat-ui-types';

function permissionPrompt(requestId: string): PermissionPromptUi {
  return {
    requestId,
    sessionId: 'visible',
    action: 'bash',
    detail: requestId,
    defaultDecision: 'ask',
    runId: 'run-perm',
  };
}

function completeTurn(sessionId: string, runId: string, status: 'completed' | 'failed' = 'completed') {
  return {
    type: 'run/terminal' as const,
    run: makeRun(runId, {
      sessionId,
      status,
      endedAt: '2026-07-24T00:00:01.000Z',
      terminalCode: status,
      ...(status === 'failed' ? { error: 'boom' } : {}),
    }),
  };
}

describe('AN-T28 single-pane: active session complete + presence', () => {
  it('does not mark the active session when presence is active', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'finish this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, completeTurn('s1', 'run-1'));
    expect(state.attentionPresence).toBe('active');
    expect(state.completedAttentionSessionIds).toEqual({});
    expect(state.failedAttentionSessionIds).toEqual({});
  });

  it('marks the active session when presence is inactive', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'attention/presence', presence: 'inactive' });
    state = chatUiReducer(state, { type: 'user/send', text: 'finish this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, completeTurn('s1', 'run-1'));
    expect(state.completedAttentionSessionIds).toEqual({ s1: true });
  });
});

describe('AN-T29 Docking: visible non-active complete', () => {
  it.each(['run/updated', 'run/terminal'] as const)(
    'does not mark a visible non-active session on %s; marks a hidden one',
    (type) => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'active' });
      state = chatUiReducer(state, {
        type: 'attention/visible-sessions',
        sessionIds: ['active', 'docked'],
      });

      state = chatUiReducer(state, {
        type,
        run: makeRun('run-docked', {
          sessionId: 'docked',
          status: 'completed',
          endedAt: '2026-07-24T00:00:01.000Z',
          terminalCode: 'completed',
        }),
      });
      expect(state.completedAttentionSessionIds).toEqual({});

      state = chatUiReducer(state, {
        type,
        run: makeRun('run-hidden', {
          sessionId: 'hidden',
          status: 'completed',
          endedAt: '2026-07-24T00:00:02.000Z',
          terminalCode: 'completed',
        }),
      });
      expect(state.completedAttentionSessionIds).toEqual({ hidden: true });
      expect(state.activeSessionId).toBe('active');
    },
  );
});

describe('AN-T30 inactive → active clears only visible session marks', () => {
  it('clears complete/failed markers for visible ids and leaves permissionQueue untouched', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'hidden' });
    state = chatUiReducer(state, {
      type: 'attention/visible-sessions',
      sessionIds: ['visible', 'visible-failed'],
    });
    state = chatUiReducer(state, { type: 'attention/presence', presence: 'inactive' });
    state = chatUiReducer(state, completeTurn('visible', 'run-visible'));
    state = chatUiReducer(state, completeTurn('visible-failed', 'run-visible-failed', 'failed'));
    state = chatUiReducer(state, completeTurn('hidden', 'run-hidden'));
    state = chatUiReducer(state, { type: 'permission/show', prompt: permissionPrompt('perm-1') });

    expect(state.completedAttentionSessionIds).toEqual({ visible: true, hidden: true });
    expect(state.failedAttentionSessionIds).toEqual({ 'visible-failed': true });
    const permissionQueue = state.permissionQueue;
    expect(permissionQueue).toHaveLength(1);

    state = chatUiReducer(state, { type: 'attention/presence', presence: 'active' });

    expect(state.attentionPresence).toBe('active');
    expect(state.completedAttentionSessionIds).toEqual({ hidden: true });
    expect(state.failedAttentionSessionIds).toEqual({});
    expect(state.permissionQueue).toBe(permissionQueue);
    expect(state.permissionPrompt?.requestId).toBe('perm-1');
  });
});

describe('AN-T31 identical visible-sessions returns the same state reference', () => {
  it('returns the same state when ids and covered are unchanged', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'attention/visible-sessions',
      sessionIds: ['a', 'b'],
      conversationCovered: false,
    });
    const afterFirst = state;
    state = chatUiReducer(state, {
      type: 'attention/visible-sessions',
      sessionIds: ['b', 'a'],
    });
    expect(state).toBe(afterFirst);

    state = chatUiReducer(state, {
      type: 'attention/visible-sessions',
      sessionIds: ['a', 'b'],
      conversationCovered: true,
    });
    expect(state.attentionConversationCovered).toBe(true);
    expect(state).not.toBe(afterFirst);
    const afterCovered = state;
    state = chatUiReducer(state, {
      type: 'attention/visible-sessions',
      sessionIds: ['a', 'b'],
      conversationCovered: true,
    });
    expect(state).toBe(afterCovered);
  });

  it('returns the same state for an identical presence action', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'attention/presence', presence: 'inactive' });
    const afterInactive = state;
    state = chatUiReducer(state, { type: 'attention/presence', presence: 'inactive' });
    expect(state).toBe(afterInactive);
  });
});
