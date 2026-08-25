import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';

describe('chatUiReducer message model snapshot', () => {
  it('stamps Host model from message/start onto the live assistant row', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'a1',
        role: 'assistant',
        runId: 'run-1',
        model: {
          protocol: 'openai-compatible',
          providerId: 'cpa',
          modelId: 'gemini-3.7-flash',
        },
      },
    });

    expect(state.messages[0]?.model).toEqual({
      protocol: 'openai-compatible',
      providerId: 'cpa',
      modelId: 'gemini-3.7-flash',
    });
  });

  it('merges model snapshot from transcript/append onto existing live assistant row', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'a1',
        role: 'assistant',
        runId: 'run-1',
      },
    });

    expect(state.messages[0]?.model).toBeUndefined();

    state = chatUiReducer(state, {
      type: 'transcript/append',
      sessionId: 's1',
      message: {
        id: 'a1',
        role: 'assistant',
        text: 'hello',
        status: 'done',
        createdAt: '2026-08-23T14:15:00.000Z',
        model: {
          protocol: 'anthropic-compatible',
          providerId: 'anthropic',
          modelId: 'claude-3-7-sonnet',
        },
      },
    });

    expect(state.messages[0]?.model).toEqual({
      protocol: 'anthropic-compatible',
      providerId: 'anthropic',
      modelId: 'claude-3-7-sonnet',
    });
  });
});
