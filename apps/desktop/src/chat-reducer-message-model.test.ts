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
});
