import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import type { ChatUiState, PermissionPromptUi } from './chat-ui-types';

function prompt(
  requestId: string,
  overrides: Partial<PermissionPromptUi> = {},
): PermissionPromptUi {
  return {
    requestId,
    sessionId: 'session-1',
    action: 'bash',
    detail: requestId,
    defaultDecision: 'ask',
    runId: 'run-1',
    ...overrides,
  };
}

describe('chatUiReducer permission queue', () => {
  it('drops a stale prompt for the active session but keeps a subagent child prompt', () => {
    let state: ChatUiState = {
      ...createInitialChatUiState(),
      activeSessionId: 'session-1',
      activeRunId: 'parent-run',
    };
    state = chatUiReducer(state, {
      type: 'permission/show',
      prompt: prompt('stale', { runId: 'old-run' }),
    });
    expect(state.permissionQueue).toHaveLength(0);
    state = chatUiReducer(state, {
      type: 'permission/show',
      prompt: prompt('child', { sessionId: 'child-session', runId: 'child-task-run' }),
    });
    expect(state.permissionPrompt?.requestId).toBe('child');
  });

  it('queues two permission/show events with the same runId', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'permission/show', prompt: prompt('a') });
    state = chatUiReducer(state, { type: 'permission/show', prompt: prompt('b') });
    expect(state.permissionPrompt?.requestId).toBe('a');
    expect(state.permissionQueue.map((item) => item.requestId)).toEqual(['a', 'b']);
  });

  it('surfaces the second prompt after the head is resolved', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'permission/show', prompt: prompt('a') });
    state = chatUiReducer(state, { type: 'permission/show', prompt: prompt('b') });
    state = chatUiReducer(state, { type: 'permission/clear', requestId: 'a' });
    expect(state.permissionPrompt?.requestId).toBe('b');
    expect(state.permissionQueue).toHaveLength(1);
  });

  it('ignores a duplicate request id', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'permission/show', prompt: prompt('a') });
    const afterFirst = state;
    state = chatUiReducer(state, {
      type: 'permission/show',
      prompt: prompt('a', { detail: 'changed' }),
    });
    expect(state).toBe(afterFirst);
  });

  it('clears every prompt for a finished run', () => {
    let state = createInitialChatUiState();
    state = {
      ...state,
      activeSessionId: 'session-1',
      activeRunId: 'run-1',
    };
    state = chatUiReducer(state, { type: 'permission/show', prompt: prompt('a') });
    state = chatUiReducer(state, { type: 'permission/show', prompt: prompt('b') });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: {
        runId: 'run-1',
        kind: 'session-turn',
        status: 'completed',
        rootRunId: 'run-1',
        sessionId: 'session-1',
      },
    });
    expect(state.permissionPrompt).toBeNull();
    expect(state.permissionQueue).toEqual([]);
  });

  it('queues concurrent child-session permission requests', () => {
    let state = createInitialChatUiState();
    state = { ...state, activeSessionId: 'parent-1' };
    state = chatUiReducer(state, {
      type: 'subagent/stream',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      event: {
        type: 'permission/request',
        requestId: 'child-a',
        action: 'bash',
        detail: 'ls',
        defaultDecision: 'ask',
        runId: 'run-child',
      },
    });
    state = chatUiReducer(state, {
      type: 'subagent/stream',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      event: {
        type: 'permission/request',
        requestId: 'child-b',
        action: 'bash',
        detail: 'pwd',
        defaultDecision: 'ask',
        runId: 'run-child',
      },
    });
    const stream = state.subagentStreams['child-1'];
    expect(stream?.permissionPrompt?.requestId).toBe('child-a');
    expect(stream?.permissionQueue?.map((item) => item.requestId)).toEqual(['child-a', 'child-b']);

    state = chatUiReducer(state, {
      type: 'subagent/stream',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      event: {
        type: 'permission/resolved',
        requestId: 'child-a',
        decision: 'allow',
      },
    });
    expect(state.subagentStreams['child-1']?.permissionPrompt?.requestId).toBe('child-b');
  });
});
