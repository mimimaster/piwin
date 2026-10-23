import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';
import { makeRun } from './chat-reducer-test-harness';

describe('chatUiReducer cross-run failures', () => {
  it('does not hide a follow-up failure by painting the previous completed assistant', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'first' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-old' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'assistant-old',
        role: 'assistant',
        runId: 'run-old',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/text_delta',
        messageId: 'assistant-old',
        delta: 'previous turn finished',
        runId: 'run-old',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'assistant-old', runId: 'run-old' },
    });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-old', {
        status: 'completed',
        endedAt: '2026-09-08T09:25:41.000Z',
        terminalCode: 'completed',
      }),
    });
    state = chatUiReducer(state, { type: 'user/send', text: '这是你干的吗？' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-new' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-new', {
        status: 'failed',
        endedAt: '2026-09-08T09:27:14.000Z',
        error: 'Unexpected non-whitespace character after JSON at position 5957',
      }),
    });

    const previous = state.messages.find((message) => message.id === 'assistant-old');
    expect(previous).toMatchObject({
      status: 'done',
      runId: 'run-old',
      text: 'previous turn finished',
    });
    expect(previous?.error).toBeUndefined();
    expect(state.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'error',
      runId: 'run-new',
      error: 'Unexpected non-whitespace character after JSON at position 5957',
    });
    expect(state.runRecordsById['run-new']?.outcome).toBe('failed');
  });

  it('does not paint a live event:error onto the previous completed assistant', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'first' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-old' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'assistant-old',
        role: 'assistant',
        runId: 'run-old',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/text_delta',
        messageId: 'assistant-old',
        delta: 'previous turn finished',
        runId: 'run-old',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'assistant-old', runId: 'run-old' },
    });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-old', {
        status: 'completed',
        endedAt: '2026-09-08T09:25:41.000Z',
        terminalCode: 'completed',
      }),
    });
    state = chatUiReducer(state, { type: 'user/send', text: 'follow up' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-new' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'error',
        message: 'Unexpected non-whitespace character after JSON',
        runId: 'run-new',
      },
    });

    const previous = state.messages.find((message) => message.id === 'assistant-old');
    expect(previous).toMatchObject({ status: 'done', runId: 'run-old' });
    expect(previous?.error).toBeUndefined();
    expect(state.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'error',
      runId: 'run-new',
      error: 'Unexpected non-whitespace character after JSON',
    });
  });
});
