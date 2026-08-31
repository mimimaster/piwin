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

  it('does not stamp the session-list composer model onto a message without a turn snapshot', () => {
    const composerModel = {
      protocol: 'openai-compatible' as const,
      providerId: 'xgrok',
      modelId: 'grok-4',
    };
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/hydrate',
      sessions: [{ id: 's1', name: 'Chat', model: composerModel }],
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
    });

    expect(state.messages.find((message) => message.id === 'a1')?.model).toBeUndefined();
  });

  it('fills a missing snapshot when a later message/start for the same row carries the model', () => {
    const turnModel = {
      protocol: 'anthropic-compatible' as const,
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4',
    };
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'hello', runId: 'run-1' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'a1',
        role: 'assistant',
        runId: 'run-1',
        model: turnModel,
      },
    });

    const row = state.messages.find((message) => message.id === 'a1');
    expect(row?.text).toBe('hello');
    expect(row?.model).toEqual(turnModel);
  });

  it('keeps the send-time model when a later transcript hydrate omits it', () => {
    const turnModel = {
      protocol: 'openai-compatible' as const,
      providerId: 'custom-openai',
      modelId: 'win/glm5.2',
    };
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'hello',
      clientMessageId: 'u1',
      model: turnModel,
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'a1', runId: 'run-1' },
    });

    expect(state.messages.find((message) => message.id === 'a1')?.model).toEqual(turnModel);

    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'hello',
          createdAt: '2026-08-31T00:00:00.000Z',
          status: 'done',
        },
        {
          id: 'a1',
          role: 'assistant',
          text: 'hi',
          createdAt: '2026-08-31T00:00:01.000Z',
          status: 'done',
        },
      ],
    });

    expect(state.messages.find((message) => message.id === 'a1')?.model).toEqual(turnModel);
  });
});
