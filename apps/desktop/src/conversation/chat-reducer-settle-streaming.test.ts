import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState, type ChatUiState } from './chat-reducer';
import type { AgentEvent } from '@piwin/contracts';
import { makeRun } from './chat-reducer-test-harness';

function send(state: ChatUiState, event: AgentEvent): ChatUiState {
  return chatUiReducer(state, { type: 'event', sessionId: 's1', event });
}

function startedRun(): ChatUiState {
  let state = createInitialChatUiState();
  state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
  return chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
}

function message(state: ChatUiState, id: string) {
  return state.messages.find((item) => item.id === id);
}

describe('settling assistant rows whose message/end never arrived', () => {
  it('closes an earlier response of the run when the next response starts', () => {
    let state = startedRun();
    state = send(state, { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' });
    state = send(state, { type: 'message/thinking_delta', messageId: 'a1', delta: 'plan', runId: 'run-1' });
    // a1's message/end is lost.
    state = send(state, { type: 'message/start', messageId: 'a2', role: 'assistant', runId: 'run-1' });

    expect(message(state, 'a1')?.status).toBe('done');
    expect(message(state, 'a1')?.thinkingEndedAt).toEqual(expect.any(Number));
    expect(message(state, 'a2')?.status).toBe('streaming');
  });

  it('drops an empty placeholder of the run instead of keeping it live', () => {
    let state = startedRun();
    state = send(state, { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' });
    state = send(state, { type: 'message/start', messageId: 'a2', role: 'assistant', runId: 'run-1' });

    expect(state.messages.map((item) => item.id)).toEqual(['a2']);
  });

  it('closes every streaming response of a run when the run ends', () => {
    let state = startedRun();
    state = send(state, { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' });
    state = send(state, { type: 'message/text_delta', messageId: 'a1', delta: 'done soon', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-09-15T00:00:00.000Z',
        terminalCode: 'completed',
      }),
    });

    expect(message(state, 'a1')?.status).toBe('done');

    // A same-run delta racing past the terminal keeps its text but does not reopen the row.
    state = send(state, { type: 'message/text_delta', messageId: 'a1', delta: '!', runId: 'run-1' });
    expect(message(state, 'a1')).toMatchObject({ text: 'done soon!', status: 'done' });
  });

  it('keeps an empty placeholder open past the terminal and closes it when late tokens land', () => {
    let state = startedRun();
    state = send(state, { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-09-15T00:00:00.000Z',
        terminalCode: 'completed',
      }),
    });
    expect(message(state, 'a1')?.status).toBe('streaming');

    state = send(state, { type: 'message/text_delta', messageId: 'a1', delta: 'late', runId: 'run-1' });
    expect(message(state, 'a1')).toMatchObject({ text: 'late', status: 'done' });
  });

  it('closes every streaming response on abort, not only the named one', () => {
    let state = startedRun();
    state = send(state, { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' });
    state = send(state, { type: 'message/text_delta', messageId: 'a1', delta: 'partial', runId: 'run-1' });
    state = send(state, { type: 'session/aborted', sessionId: 's1', messageId: 'other', runId: 'run-1' });

    expect(message(state, 'a1')).toMatchObject({ text: 'partial', status: 'done' });
  });
});
