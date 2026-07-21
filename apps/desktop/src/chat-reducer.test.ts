import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';

describe('chatUiReducer', () => {
  it('accumulates assistant text deltas', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'event',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'hi ' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'there' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      event: { type: 'message/end', messageId: 'a1' },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toBe('hi there');
    expect(state.streaming).toBe(false);
  });

  it('stores attachments on user/send', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'see image',
      attachments: [
        {
          id: 'a1',
          path: '/tmp/media/s/a.png',
          mimeType: 'image/png',
          byteSize: 12,
          source: 'paste',
        },
      ],
    });
    expect(state.messages[0]?.attachments).toHaveLength(1);
    expect(state.messages[0]?.attachments[0]?.path).toContain('a.png');
  });

  it('clears the prior project transcript while loading another project', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/add',
      sessionId: 'prior-session',
      name: 'Prior project chat',
    });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'This belongs to the prior project',
    });

    state = chatUiReducer(state, {
      type: 'project/set',
      path: '/tmp/another-project',
      trusted: false,
    });

    expect(state.sessions).toEqual([]);
    expect(state.activeSessionId).toBeNull();
    expect(state.messages).toEqual([]);
    expect(state.streaming).toBe(false);
  });

  it('hydrates history from session/load-messages including attachments', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'with image',
          createdAt: new Date().toISOString(),
          status: 'done',
          attachments: [
            {
              id: 'a1',
              path: '/tmp/.piwin/media/s/a.png',
              mimeType: 'image/png',
              byteSize: 10,
              source: 'paste',
            },
          ],
        },
        {
          id: 'a2',
          role: 'assistant',
          text: 'seen',
          createdAt: new Date().toISOString(),
          status: 'done',
        },
      ],
    });
    expect(state.activeSessionId).toBe('s1');
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]?.attachments[0]?.path).toContain('a.png');
    expect(state.messages[1]?.text).toBe('seen');
  });

  it('tracks compaction banner state', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'event',
      event: { type: 'compaction/start' },
    });
    expect(state.compacting).toBe(true);
    state = chatUiReducer(state, {
      type: 'event',
      event: { type: 'compaction/end', ok: true, message: 'done' },
    });
    expect(state.compacting).toBe(false);
    expect(state.lastCompactionMessage).toBe('done');
  });

  it('stores compaction detail fields without inventing tokens', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'event',
      event: {
        type: 'compaction/end',
        ok: true,
        message: 'done',
        summary: 'kept recent tools',
        tokensBefore: 1000,
        tokensAfter: 400,
        durationMs: 42,
      },
    });
    expect(state.lastCompactionMessage).toBe('done');
    expect(state.lastCompactionSummary).toBe('kept recent tools');
    expect(state.lastCompactionTokensBefore).toBe(1000);
    expect(state.lastCompactionTokensAfter).toBe(400);
    expect(state.lastCompactionDurationMs).toBe(42);
    state = chatUiReducer(state, { type: 'compaction/dismiss' });
    expect(state.lastCompactionMessage).toBeNull();
    expect(state.lastCompactionSummary).toBeNull();
  });

  it('stores usage/update on contextUsage', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'event',
      event: {
        type: 'usage/update',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          totalTokens: 42,
          tokensLimit: 128000,
          updatedAt: '2026-07-21T00:00:00.000Z',
          source: 'host-estimate',
        },
      },
    });
    expect(state.contextUsage?.totalTokens).toBe(42);
  });

  it('session/truncate replaces active transcript', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'one',
          createdAt: '2026-07-21T00:00:00.000Z',
          status: 'done',
        },
        {
          id: 'a1',
          role: 'assistant',
          text: 'two',
          createdAt: '2026-07-21T00:00:01.000Z',
          status: 'done',
        },
      ],
    });
    state = chatUiReducer(state, {
      type: 'session/truncate',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'one',
          createdAt: '2026-07-21T00:00:00.000Z',
          status: 'done',
        },
      ],
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.id).toBe('u1');
  });
});
