import { describe, expect, it } from 'vitest';
import type { AgentEvent, SessionTranscriptMessage } from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState, type ChatUiState } from './chat-reducer';

function send(state: ChatUiState, event: AgentEvent): ChatUiState {
  return chatUiReducer(state, { type: 'event', sessionId: 's1', event });
}

function bash(toolCallId: string, status: 'running' | 'done') {
  return { toolCallId, toolName: 'bash', status, output: status === 'done' ? 'ok' : '', runId: 'run-1' };
}

function persisted(
  id: string,
  overrides: Partial<SessionTranscriptMessage> = {},
): SessionTranscriptMessage {
  return {
    id,
    role: 'assistant',
    text: '',
    createdAt: '2026-09-15T07:55:00.000Z',
    status: 'done',
    runId: 'run-1',
    ...overrides,
  };
}

/** Live state after a push hole swallowed a205's end + tools and all of a206. */
function liveStateAfterLostPushes(): ChatUiState {
  let state = createInitialChatUiState();
  state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
  state = chatUiReducer(state, { type: 'user/send', text: 'go', clientMessageId: 'u1' });
  state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
  state = send(state, { type: 'message/start', messageId: 'a205', role: 'assistant', runId: 'run-1' });
  state = send(state, {
    type: 'message/text_delta',
    messageId: 'a205',
    delta: 'Now the screenshot derivative',
    runId: 'run-1',
  });
  // A row Host never persisted: its lifecycle half-arrived around the hole.
  state = send(state, { type: 'message/start', messageId: 'orphan', role: 'assistant', runId: 'run-1' });
  state = send(state, { type: 'message/thinking_delta', messageId: 'orphan', delta: '…', runId: 'run-1' });
  state = send(state, { type: 'message/start', messageId: 'a207', role: 'assistant', runId: 'run-1' });
  state = send(state, {
    type: 'tool/start',
    toolCallId: 't207',
    toolName: 'bash',
    runId: 'run-1',
    responseMessageId: 'a207',
  });
  return state;
}

describe('merging a transcript page into a live run after lost pushes', () => {
  it('restores closed rows from Host, keeps the streaming tail, and drops orphans', () => {
    const state = chatUiReducer(liveStateAfterLostPushes(), {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        { id: 'u1', role: 'user', text: 'go', createdAt: '2026-09-15T07:50:00.000Z', status: 'done' },
        persisted('a205', {
          text: 'Now the screenshot derivative',
          tools: [
            { toolCallId: 'w1', toolName: 'write_file', status: 'done', output: 'Wrote a.ts', runId: 'run-1' },
            { toolCallId: 'w2', toolName: 'write_file', status: 'done', output: 'Wrote b.ts', runId: 'run-1' },
          ],
        }),
        persisted('a206', { tools: [bash('t206', 'done')] }),
        persisted('a207', { status: 'streaming', tools: [] }),
      ],
      preserveActiveTail: true,
    });

    expect(state.messages.map((message) => message.id)).toEqual(['u1', 'a205', 'a206', 'a207']);
    expect(state.messages[1]).toMatchObject({ status: 'done' });
    expect(state.messages[1]?.tools.map((tool) => tool.toolCallId)).toEqual(['w1', 'w2']);
    expect(state.messages[2]?.tools.map((tool) => tool.toolCallId)).toEqual(['t206']);
    // Host still streams a207: the live copy (with its running tool) wins.
    expect(state.messages[3]).toMatchObject({ status: 'streaming' });
    expect(state.messages[3]?.tools.map((tool) => tool.status)).toEqual(['running']);
    expect(state.streaming).toBe(true);
  });

  it('does not append the only query and stale opening reply after a disjoint Host tail', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'only query', clientMessageId: 'u1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = send(state, {
      type: 'message/start',
      messageId: 'a1',
      role: 'assistant',
      runId: 'run-1',
    });
    state = send(state, {
      type: 'message/text_delta',
      messageId: 'a1',
      delta: 'first reply',
      runId: 'run-1',
    });
    state = send(state, {
      type: 'tool/start',
      toolCallId: 'stale-tool',
      toolName: 'bash',
      runId: 'run-1',
      responseMessageId: 'a1',
    });

    // All intervening pushes were lost. The bounded tail starts after both
    // resident rows; timestamps deliberately cannot order the two machines.
    const refreshed = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [persisted('a52', { tools: [bash('t52', 'done')] }), persisted('a53')],
      transcriptPage: {
        revision: 'r1',
        totalCount: 54,
        startIndex: 52,
        endIndex: 54,
        messageBytes: 256,
        messagePositions: [
          { messageId: 'u1', index: 0 },
          { messageId: 'a1', index: 1 },
        ],
      },
      preserveActiveTail: true,
    });

    expect(refreshed.messages.map((message) => message.id)).toEqual(['a52', 'a53']);
    expect(refreshed.messages.some((message) => message.role === 'user')).toBe(false);
    expect(
      refreshed.messages.some((message) => message.tools.some((tool) => tool.status === 'running')),
    ).toBe(false);
    expect(refreshed.streaming).toBe(true);
  });

  it('preserves a not-yet-persisted response beyond a disjoint refreshed tail', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'only query', clientMessageId: 'u1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = send(state, {
      type: 'message/start',
      messageId: 'new-live',
      role: 'assistant',
      runId: 'run-1',
    });
    state = send(state, {
      type: 'message/text_delta',
      messageId: 'new-live',
      delta: 'new tokens',
      runId: 'run-1',
    });
    const refreshed = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [persisted('a52')],
      transcriptPage: {
        revision: 'r1',
        totalCount: 53,
        startIndex: 52,
        endIndex: 53,
        messageBytes: 128,
        messagePositions: [{ messageId: 'u1', index: 0 }],
      },
      preserveActiveTail: true,
    });
    expect(refreshed.messages.map((message) => message.id)).toEqual(['a52', 'new-live']);
    expect(refreshed.messages.at(-1)).toMatchObject({ text: 'new tokens', status: 'streaming' });
  });

  it('keeps a settled live tool when the page was read before its tool/end', () => {
    let state = liveStateAfterLostPushes();
    state = send(state, { type: 'message/end', messageId: 'a207', runId: 'run-1' });
    state = send(state, { type: 'tool/end', toolCallId: 't207', runId: 'run-1', isError: false, responseMessageId: 'a207' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        { id: 'u1', role: 'user', text: 'go', createdAt: '2026-09-15T07:50:00.000Z', status: 'done' },
        persisted('a207', { tools: [bash('t207', 'running')] }),
      ],
      preserveActiveTail: true,
    });

    const a207 = state.messages.find((message) => message.id === 'a207');
    expect(a207?.tools.map((tool) => tool.status)).toEqual(['done']);
  });

  it('keeps local responses after the last row Host knows, since they may not be persisted yet', () => {
    const state = chatUiReducer(liveStateAfterLostPushes(), {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        { id: 'u1', role: 'user', text: 'go', createdAt: '2026-09-15T07:50:00.000Z', status: 'done' },
        persisted('a205', { text: 'Now the screenshot derivative' }),
      ],
      preserveActiveTail: true,
    });

    expect(state.messages.map((message) => message.id)).toEqual(['u1', 'a205', 'orphan', 'a207']);
  });
});
