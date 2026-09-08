import { describe, expect, it, vi } from 'vitest';
import type { QueuedTurnRecord } from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState, mapTranscriptMessagesToUi } from './chat-reducer';
import { makeRun } from './chat-reducer-test-harness';

describe('chatUiReducer', () => {
  it('projects queued-turn lifecycle pushes onto the optimistic user bubble', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'queued request',
      clientMessageId: 'queued-user',
    });
    const pending: QueuedTurnRecord = {
      queuedTurnId: 'queued-1',
      revision: 1,
      sessionId: 's1',
      sequence: 1,
      userMessageId: 'queued-user',
      mode: 'next',
      status: 'pending',
      input: { text: 'queued request', clientMessageId: 'queued-user' },
      submittedAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:00.000Z',
    };
    state = chatUiReducer(state, { type: 'session/queued-turn-updated', queuedTurn: pending });
    expect(state.messages[0]?.instructionDelivery).toMatchObject({
      kind: 'queued-turn',
      instructionId: 'queued-1',
      status: 'pending',
      revision: 1,
    });

    const started: QueuedTurnRecord = {
      ...pending,
      revision: 2,
      status: 'started',
      startedRunId: 'run-queued',
      updatedAt: '2026-08-15T00:00:01.000Z',
    };
    state = chatUiReducer(state, { type: 'session/queued-turn-updated', queuedTurn: started });
    expect(state.messages[0]?.runId).toBe('run-queued');
    expect(state.messages[0]?.instructionDelivery).toMatchObject({
      status: 'started',
      targetRunId: 'run-queued',
      revision: 2,
    });
    const beforeStale = state;
    state = chatUiReducer(state, {
      type: 'session/queued-turn-updated',
      queuedTurn: { ...pending, revision: 1 },
    });
    expect(state).toBe(beforeStale);
  });

  it('rejects stale queue hydration while retaining the latest queue revision', () => {
    let state = createInitialChatUiState();
    const record: QueuedTurnRecord = {
      queuedTurnId: 'queued-1',
      revision: 2,
      sessionId: 's1',
      sequence: 1,
      userMessageId: 'queued-user',
      mode: 'next',
      status: 'pending',
      input: { text: 'queued request', clientMessageId: 'queued-user' },
      submittedAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:01.000Z',
    };
    state = chatUiReducer(state, {
      type: 'session/queued-turns-hydrate',
      sessionId: 's1',
      queueRevision: 4,
      queuedTurns: [record],
    });
    const beforeStale = state;
    state = chatUiReducer(state, {
      type: 'session/queued-turns-hydrate',
      sessionId: 's1',
      queueRevision: 3,
      queuedTurns: [],
    });
    expect(state).toBe(beforeStale);
    expect(state.queuedTurnQueueRevisions.s1).toBe(4);
    expect(state.queuedTurnsBySession.s1).toEqual([record]);
  });

  it('records the reasoning interval and closes it when tool work begins', () => {
    const now = vi.spyOn(Date, 'now');
    try {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/start',
          messageId: 'thinking-a1',
          role: 'assistant',
          runId: 'run-1',
        },
      });

      now.mockReturnValue(1_000);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/thinking_delta',
          messageId: 'thinking-a1',
          delta: 'Inspecting',
          runId: 'run-1',
        },
      });
      now.mockReturnValue(2_000);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/thinking_delta',
          messageId: 'thinking-a1',
          delta: ' files',
          runId: 'run-1',
        },
      });
      now.mockReturnValue(5_000);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'tool/start',
          toolCallId: 'tool-1',
          toolName: 'read',
          responseMessageId: 'thinking-a1',
          runId: 'run-1',
        },
      });

      expect(state.messages[0]?.thinkingStartedAt).toBe(1_000);
      expect(state.messages[0]?.thinkingEndedAt).toBe(5_000);

      now.mockReturnValue(9_000);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/text_delta',
          messageId: 'thinking-a1',
          delta: 'Done',
          runId: 'run-1',
        },
      });
      expect(state.messages[0]?.thinkingEndedAt).toBe(5_000);
    } finally {
      now.mockRestore();
    }
  });

  it('ends thinking and records tool-arg progress before tool/start', () => {
    const now = vi.spyOn(Date, 'now');
    try {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/start',
          messageId: 'compose-a1',
          role: 'assistant',
          runId: 'run-1',
        },
      });
      now.mockReturnValue(1_000);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/thinking_delta',
          messageId: 'compose-a1',
          delta: 'write the prototype',
          runId: 'run-1',
        },
      });
      now.mockReturnValue(4_000);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/tool_args_progress',
          messageId: 'compose-a1',
          argumentCharCount: 2400,
          toolName: 'write_file',
          runId: 'run-1',
        },
      });
      expect(state.messages[0]?.thinkingEndedAt).toBe(4_000);
      expect(state.messages[0]?.toolArgsProgress).toEqual({
        argumentCharCount: 2400,
        toolName: 'write_file',
      });

      now.mockReturnValue(5_000);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'tool/start',
          toolCallId: 'tool-1',
          toolName: 'write_file',
          responseMessageId: 'compose-a1',
          runId: 'run-1',
        },
      });
      expect(state.messages[0]?.toolArgsProgress).toBeUndefined();
      expect(state.messages[0]?.tools[0]?.toolName).toBe('write_file');
    } finally {
      now.mockRestore();
    }
  });

  it('accumulates assistant text deltas', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'hi ' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'there' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'a1' },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toBe('hi there');
    expect(state.streaming).toBe(false);
    expect(state.completedAttentionSessionIds).toEqual({});
  });

  it('does not clear an active Host run on message/end without runId', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/updated', run: makeRun('run-1') });
    expect(state.activeRunId).toBe('run-1');
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'a1' },
    });
    expect(state.activeRunId).toBe('run-1');
    expect(state.streaming).toBe(true);
    expect(state.runPhase).toBe('streaming');
  });

  it('projects live native search evidence onto the assistant message', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'native-a1', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/search_evidence',
        messageId: 'native-a1',
        evidence: {
          query: 'piwin',
          provenance: 'native',
          citations: [{ title: 'Piwin', url: 'https://example.com/piwin', provenance: 'native' }],
        },
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'native-a1' },
    });

    expect(state.messages[0]?.searchEvidence).toEqual({
      query: 'piwin',
      provenance: 'native',
      citations: [{ title: 'Piwin', url: 'https://example.com/piwin', provenance: 'native' }],
    });
  });

  it('hydrates normalized search evidence without provider payload fields', () => {
    const [assistant] = mapTranscriptMessagesToUi([
      {
        id: 'native-hydrated',
        role: 'assistant',
        text: 'grounded answer',
        createdAt: '2026-08-10T00:00:00.000Z',
        status: 'done',
        searchEvidence: {
          provenance: 'native',
          citations: [{ title: 'Piwin', url: 'https://example.com/piwin', provenance: 'native' }],
        },
      },
    ]);

    expect(assistant?.searchEvidence).toEqual({
      provenance: 'native',
      citations: [{ title: 'Piwin', url: 'https://example.com/piwin', provenance: 'native' }],
    });
  });

  it('does not create duplicate bubbles for a replayed assistant start event', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    const startEvent = {
      type: 'message/start' as const,
      messageId: 'assistant-1',
      role: 'assistant' as const,
    };
    state = chatUiReducer(state, { type: 'event', sessionId: 's1', event: startEvent });
    state = chatUiReducer(state, { type: 'event', sessionId: 's1', event: startEvent });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.id).toBe('assistant-1');
  });

  it('prunes an empty assistant lifecycle once the next answer starts', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'empty-assistant', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'empty-assistant' },
    });

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.id).toBe('empty-assistant');

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'real-assistant', role: 'assistant' },
    });
    expect(state.messages.map((message) => message.id)).toEqual(['real-assistant']);
  });

  it('attaches generated video after Pi ends the tool-call message first', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'assistant-tool',
        role: 'assistant',
        runId: 'run-1',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'assistant-tool', runId: 'run-1' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/start',
        toolCallId: 'tool-video',
        toolName: 'piwin_toolbox',
        runId: 'run-1',
        responseMessageId: 'assistant-tool',
        presentation: {
          kind: 'video',
          title: 'video_gen',
          routedToolName: 'video_gen',
        },
      },
    });
    const generatedAttachment = {
      id: 'video-1',
      kind: 'media' as const,
      path: '/tmp/.piwin/media/s1/video-1.mp4',
      mimeType: 'video/mp4',
      byteSize: 1210988,
      source: 'generated' as const,
    };
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/end',
        toolCallId: 'tool-video',
        isError: false,
        runId: 'run-1',
        responseMessageId: 'assistant-tool',
        attachments: [generatedAttachment],
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'assistant-text',
        role: 'assistant',
        runId: 'run-1',
      },
    });

    expect(state.messages[0]?.id).toBe('assistant-tool');
    expect(state.messages[0]?.attachments).toEqual([generatedAttachment]);
    expect(state.messages[1]?.id).toBe('assistant-text');
    expect(state.messages[1]?.attachments).toEqual([]);
  });

  it('accepts a run and ignores terminal events from an older run', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'first' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        phase: 'streaming',
        endedAt: '2026-07-24T00:00:00.000Z',
        terminalCode: 'completed',
      }),
    });
    state = chatUiReducer(state, { type: 'user/send', text: 'second' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-2' });

    const beforeLateEvent = state;
    const afterLateEvent = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/text_delta',
        messageId: 'old-assistant',
        delta: 'late output',
        runId: 'run-1',
      },
    });

    expect(afterLateEvent).toBe(beforeLateEvent);
    expect(afterLateEvent.activeRunId).toBe('run-2');
  });

  it('clears the working marker when the active run reaches a terminal state', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'run this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    expect(state.workingSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        phase: 'streaming',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'completed',
      }),
    });

    expect(state.workingSessionIds).toEqual({});
    expect(state.completedAttentionSessionIds).toEqual({});
    expect(state.streaming).toBe(false);
  });

  it('clears a leftover working marker when hydrating a session that has no active run', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'run this' });
    expect(state.workingSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'run this',
          createdAt: '2026-07-24T00:00:00.000Z',
          status: 'done',
        },
        {
          id: 'a1',
          role: 'assistant',
          text: 'done',
          createdAt: '2026-07-24T00:00:01.000Z',
          status: 'done',
        },
      ],
    });

    expect(state.workingSessionIds).toEqual({});
    expect(state.streaming).toBe(false);
    expect(state.runPhase).toBe('idle');
  });

  it('clears a background working marker from a terminal-shaped run/updated', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'run in background' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    expect(state.workingSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, {
      type: 'run/updated',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'completed',
      }),
    });

    expect(state.workingSessionIds).toEqual({});
    expect(state.activeSessionId).toBe('s2');
    expect(state.streaming).toBe(false);
    expect(state.completedAttentionSessionIds).toEqual({ s1: true });
  });

  it('does not revive the sidebar spinner from a late running projection of a terminal run', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'finish this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'completed',
      }),
    });
    expect(state.workingSessionIds).toEqual({});

    state = chatUiReducer(state, {
      type: 'run/updated',
      run: makeRun('run-1', { status: 'running', phase: 'streaming' }),
    });

    expect(state.workingSessionIds).toEqual({});
    expect(state.streaming).toBe(false);
    expect(state.runPhase).toBe('idle');
    expect(state.activeRunId).toBeNull();
  });

  it('run/stale-clear returns a stuck streaming thread to its resting state', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'run this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    expect(state.runPhase).toBe('streaming');
    expect(state.workingSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, { type: 'run/stale-clear', sessionId: 's1' });

    expect(state.runPhase).toBe('idle');
    expect(state.streaming).toBe(false);
    expect(state.activeRunId).toBeNull();
    expect(state.workingSessionIds).toEqual({});
  });

  it('run/stale-clear keeps an already-resting thread unchanged apart from markers', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    const before = state;
    state = chatUiReducer(state, { type: 'run/stale-clear', sessionId: 's1' });
    expect(state).toEqual(before);
  });

  it('run/stale-clear only drops the background marker for a non-active session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'background run' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    state = chatUiReducer(state, { type: 'user/send', text: 'foreground run' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-2' });

    state = chatUiReducer(state, { type: 'run/stale-clear', sessionId: 's1' });

    expect(state.workingSessionIds).toEqual({ s2: true });
    expect(state.runPhase).toBe('streaming');
    expect(state.activeRunId).toBe('run-2');
  });

  it('does not mark the active session when a terminal-shaped run update precedes the terminal push', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'complete this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });

    state = chatUiReducer(state, {
      type: 'run/updated',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'completed',
      }),
    });
    expect(state.completedAttentionSessionIds).toEqual({});

    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'completed',
      }),
    });
    expect(state.completedAttentionSessionIds).toEqual({});
  });

  it('clears a background working marker when its terminal push arrives after a session switch', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'run in background' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    expect(state.workingSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        phase: 'streaming',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'completed',
      }),
    });

    expect(state.workingSessionIds).toEqual({});
    expect(state.activeSessionId).toBe('s2');
    expect(state.completedAttentionSessionIds).toEqual({ s1: true });
  });

  it('clears a completion marker when the user opens that session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'finish this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'completed',
      }),
    });
    expect(state.completedAttentionSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    expect(state.completedAttentionSessionIds).toEqual({});
  });

  it('clears a completion marker when the user dismisses the attention checkmark', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'finish this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'completed',
      }),
    });
    expect(state.completedAttentionSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, { type: 'session/attention-dismiss', sessionId: 's1' });
    expect(state.completedAttentionSessionIds).toEqual({});
    expect(state.activeSessionId).toBe('s2');
  });

  it('marks a failed attention marker (not a completed one) for a background failure', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'run in background' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });

    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'failed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'failed',
        error: 'boom',
      }),
    });

    expect(state.workingSessionIds).toEqual({});
    expect(state.failedAttentionSessionIds).toEqual({ s1: true });
    expect(state.completedAttentionSessionIds).toEqual({});
  });

  it('clears a failed attention marker when the user opens that session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'finish this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'failed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'failed',
        error: 'boom',
      }),
    });
    expect(state.failedAttentionSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    expect(state.failedAttentionSessionIds).toEqual({});
  });

  it('clears a failed attention marker when the user dismisses it', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'finish this' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'failed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'failed',
        error: 'boom',
      }),
    });
    expect(state.failedAttentionSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, { type: 'session/attention-dismiss', sessionId: 's1' });
    expect(state.failedAttentionSessionIds).toEqual({});
    expect(state.activeSessionId).toBe('s2');
  });

  it('does not treat a live session handle as an active run while restoring history', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [],
    });

    expect(state.workingSessionIds).toEqual({});
    expect(state.streaming).toBe(false);
  });

  it('keeps a Host-confirmed foreground run live when transcript hydration races it', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'run/updated',
      run: makeRun('run-live', { phase: 'waiting-first-token' }),
    });

    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'user-1',
          role: 'user',
          text: 'still working',
          createdAt: '2026-08-25T00:00:00.000Z',
          status: 'done',
        },
      ],
    });

    expect(state.activeRunId).toBe('run-live');
    expect(state.runPhase).toBe('streaming');
    expect(state.streaming).toBe(true);
    expect(state.activeRunPhase).toBe('waiting-first-token');
    expect(state.workingSessionIds).toEqual({ s1: true });
  });

  it('keeps the optimistic user bubble when a live load omits it from the Host page', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: '检查一下',
      clientMessageId: 'client-user-1',
    });
    state = chatUiReducer(state, {
      type: 'run/accepted',
      runId: 'run-1',
      sessionId: 's1',
    });
    expect(state.messages.some((message) => message.id === 'client-user-1')).toBe(true);
    expect(state.streaming).toBe(true);
    expect(state.activeRunId).toBe('run-1');

    // Stale Host page from catch-up before the prompt is durable — must not
    // wipe the optimistic bubble while keeping the sidebar spinner.
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'older-user',
          role: 'user',
          text: 'previous turn',
          createdAt: '2026-08-25T00:00:00.000Z',
          status: 'done',
        },
      ],
    });

    expect(state.messages.some((message) => message.id === 'client-user-1')).toBe(true);
    expect(state.messages.some((message) => message.text === '检查一下')).toBe(true);
    expect(state.streaming).toBe(true);
    expect(state.activeRunId).toBe('run-1');
    expect(state.workingSessionIds).toEqual({ s1: true });
  });

  it('keeps paint-first optimistic bubble across a pre-ACK empty Host load', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'just painted',
      clientMessageId: 'client-pre-ack',
    });
    expect(state.streaming).toBe(true);
    expect(state.activeRunId).toBeNull();

    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [],
    });

    // Bubble must survive; bare streaming without a run id yields to hydration.
    expect(state.messages).toEqual([
      expect.objectContaining({ id: 'client-pre-ack', text: 'just painted' }),
    ]);
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});
  });

  it('cold resume keeps a stable empty placeholder and ignores stream until load-messages', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: 'hello from s1',
          createdAt: '2026-07-24T00:00:00.000Z',
          status: 'done',
        },
      ],
    });
    expect(state.awaitingTranscript).toBe(false);
    expect(state.messages).toHaveLength(1);

    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 's2',
      awaitTranscript: true,
    });
    expect(state.activeSessionId).toBe('s2');
    expect(state.awaitingTranscript).toBe(true);
    expect(state.transcriptOwnerSessionId).toBe('s2');
    expect(state.messages).toEqual([]);
    expect(state.warmSessionCache.byId.s1?.messages[0]?.text).toBe('hello from s1');

    // Stream events for the new session must not append onto the painted rows.
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's2',
      event: { type: 'message/start', messageId: 'a-new', role: 'assistant' },
    });
    expect(state.messages).toEqual([]);

    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's2',
      messages: [
        {
          id: 'u2',
          role: 'user',
          text: 'hello from s2',
          createdAt: '2026-07-24T00:00:01.000Z',
          status: 'done',
        },
      ],
    });
    expect(state.awaitingTranscript).toBe(false);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.text).toBe('hello from s2');
  });

  it('does not await transcript for brand-new empty sessions', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'new-1' });
    expect(state.awaitingTranscript).toBe(false);
    expect(state.messages).toEqual([]);
  });

  it('ignores walkthrough/hydrate while awaiting transcript', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 's1',
      awaitTranscript: true,
    });
    expect(state.awaitingTranscript).toBe(true);
    state = chatUiReducer(state, {
      type: 'walkthrough/hydrate',
      artifacts: [
        {
          version: 1,
          id: 'wt-a1',
          sessionId: 's1',
          messageId: 'a1',
          mode: 'default',
          model: { protocol: 'openai-compatible', providerId: 'mock', modelId: 'm' },
          sourceHash: 'h',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          status: 'ready',
          markdown: '# x',
          generatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(state.walkthroughsByMessageId).toEqual({});
  });

  it('reduces a stream event batch in order', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event/batch',
      sessionId: 's1',
      events: [
        { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
        { type: 'message/text_delta', messageId: 'a1', delta: 'hello', runId: 'run-1' },
        { type: 'message/text_delta', messageId: 'a1', delta: ' world', runId: 'run-1' },
      ],
    });

    expect(state.messages[0]?.text).toBe('hello world');
    expect(state.activeRunId).toBe('run-1');
  });

  it('preserves accepted timing and phase until terminal confirmation', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'run/accepted',
      runId: 'run-1',
      acceptedAt: '2026-07-24T00:00:00.000Z',
    });
    expect(state.activeRunPhase).toBe('accepted');
    expect(state.activeRunStartedAt).toBe(Date.parse('2026-07-24T00:00:00.000Z'));

    state = chatUiReducer(state, {
      type: 'run/updated',
      run: makeRun('run-1', {
        phase: 'waiting-first-token',
        phaseUpdatedAt: '2026-07-24T00:00:01.000Z',
      }),
    });
    expect(state.activeRunPhase).toBe('waiting-first-token');
    expect(state.activeRunId).toBe('run-1');

    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        phase: 'waiting-first-token',
        phaseUpdatedAt: '2026-07-24T00:00:01.000Z',
        endedAt: '2026-07-24T00:00:02.000Z',
        terminalCode: 'completed',
      }),
    });
    expect(state.activeRunId).toBeNull();
    expect(state.activeRunPhase).toBeNull();
    expect(state.activeRunStartedAt).toBeNull();
  });

  it('does not let a superseded cancelling run/updated clobber a newer Run', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/updated', run: makeRun('run-old') });
    state = chatUiReducer(state, { type: 'run/updated', run: makeRun('run-new') });
    expect(state.activeRunId).toBe('run-new');
    state = chatUiReducer(state, {
      type: 'run/updated',
      run: makeRun('run-old', { status: 'cancelling' }),
    });
    expect(state.activeRunId).toBe('run-new');
    expect(state.streaming).toBe(true);
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-old', { status: 'cancelled', endedAt: '2026-07-24T00:00:02.000Z' }),
    });
    expect(state.activeRunId).toBe('run-new');
    expect(state.runRecordsById['run-old']?.outcome).toBe('cancelled');
  });

  it('deduplicates equal or older Run revisions while preserving terminal delivery', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    const running = makeRun('run-1', {
      revision: 3,
      phase: 'streaming',
      phaseUpdatedAt: '2026-07-24T00:00:01.000Z',
    });
    state = chatUiReducer(state, { type: 'run/updated', run: running });
    const afterRunning = state;
    const afterDuplicate = chatUiReducer(state, { type: 'run/updated', run: running });
    expect(afterDuplicate).toBe(afterRunning);
    expect(afterDuplicate.runRecordsById).toBe(afterRunning.runRecordsById);

    const afterOlder = chatUiReducer(state, {
      type: 'run/updated',
      run: { ...running, revision: 2, phase: 'accepted' },
    });
    expect(afterOlder).toBe(afterRunning);

    const terminal = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        revision: 3,
        status: 'completed',
        phase: 'streaming',
        endedAt: '2026-07-24T00:00:02.000Z',
        terminalCode: 'completed',
      }),
    });
    expect(terminal).not.toBe(afterRunning);
    expect(terminal.activeRunId).toBeNull();
    expect(terminal.runRecordsById['run-1']?.outcome).toBe('completed');
  });

  it('re-applies an equal-revision foreground run when switching back to the still-running session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'run long' });
    const running = makeRun('run-1', {
      revision: 3,
      status: 'running',
      phase: 'streaming',
      phaseUpdatedAt: '2026-07-24T00:00:01.000Z',
    });
    state = chatUiReducer(state, { type: 'run/updated', run: running });
    expect(state.activeRunId).toBe('run-1');
    expect(state.runPhase).toBe('streaming');
    expect(state.streaming).toBe(true);

    // Switch away: warm cache keeps the rev-3 record, live projection resets.
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    expect(state.runPhase).toBe('idle');
    expect(state.activeRunId).toBeNull();
    expect(state.warmSessionCache.byId.s1?.runRecordsById['run-1']?.revision).toBe(3);

    // Switch back: warm hit restores the rev-3 record; projection is still idle.
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1', awaitTranscript: true });
    expect(state.runPhase).toBe('idle');
    expect(state.activeRunId).toBeNull();
    expect(state.runRecordsById['run-1']?.revision).toBe(3);

    // Admission snapshot returns the SAME revision (uninterrupted text stream
    // never bumps it) — it must re-establish the live projection.
    state = chatUiReducer(state, { type: 'run/updated', run: running });
    expect(state.activeRunId).toBe('run-1');
    expect(state.runPhase).toBe('streaming');
    expect(state.streaming).toBe(true);
    expect(state.workingSessionIds).toEqual({ s1: true });
  });

  it('still swallows an equal-revision replay of a run superseded by a newer terminal', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    const running = makeRun('run-1', {
      revision: 3,
      status: 'running',
      phase: 'streaming',
      phaseUpdatedAt: '2026-07-24T00:00:01.000Z',
    });
    state = chatUiReducer(state, { type: 'run/updated', run: running });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        revision: 4,
        status: 'cancelled',
        endedAt: '2026-07-24T00:00:02.000Z',
        terminalCode: 'cancelled',
      }),
    });
    expect(state.activeRunId).toBeNull();

    // A late duplicate of the pre-terminal record must not revive the run,
    // even with a reset projection.
    const before = state;
    state = chatUiReducer(state, { type: 'run/updated', run: running });
    expect(state).toBe(before);
  });
});
