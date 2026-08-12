import { describe, expect, it, vi } from 'vitest';
import type { ExecutionRunRecord } from '@piwin/contracts';
import { chatUiReducer, createInitialChatUiState, mapTranscriptMessagesToUi } from './chat-reducer';

function makeRun(runId: string, overrides: Partial<ExecutionRunRecord> = {}): ExecutionRunRecord {
  return {
    runId,
    kind: 'session-turn',
    status: 'running',
    rootRunId: runId,
    sessionId: 's1',
    startedAt: '2026-07-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('chatUiReducer', () => {
  it('records the reasoning interval and closes it when tool work begins', () => {
    const now = vi.spyOn(Date, 'now');
    try {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'thinking-a1', role: 'assistant', runId: 'run-1' },
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

  it('removes an empty assistant lifecycle instead of rendering an empty agent row', () => {
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

    expect(state.messages).toHaveLength(0);
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

  it('does not treat a live session handle as an active run while restoring history', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [],
      live: true,
    });

    expect(state.workingSessionIds).toEqual({});
    expect(state.streaming).toBe(false);
  });

  it('cold resume keeps previous rows while awaiting and ignores stream until load-messages', () => {
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
    // Cold: keep previous rows under loading banner (no empty flash).
    expect(state.messages[0]?.text).toBe('hello from s1');
    expect(state.warmSessionCache.byId.s1?.messages[0]?.text).toBe('hello from s1');

    // Stream events for the new session must not append onto the painted rows.
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's2',
      event: { type: 'message/start', messageId: 'a-new', role: 'assistant' },
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.id).toBe('u1');

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

  it('rejects a legacy delta after the run has terminated', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:00.000Z',
        terminalCode: 'completed',
      }),
    });

    const beforeLateDelta = state;
    const afterLateDelta = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/text_delta', messageId: 'late', delta: 'stale output' },
    });

    expect(afterLateDelta).toBe(beforeLateDelta);
    expect(afterLateDelta.runTerminal).toMatchObject({ kind: 'complete' });
  });

  it('bounds retained tool output while preserving the terminal status update', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'assistant-1',
        role: 'assistant',
        runId: 'run-1',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/start',
        toolCallId: 'tool-1',
        toolName: 'large-output',
        runId: 'run-1',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/update',
        toolCallId: 'tool-1',
        delta: 'x'.repeat(10 * 1024 * 1024),
        runId: 'run-1',
      },
    });

    const retainedOutput = state.messages[0]?.tools[0]?.output ?? '';
    expect(new TextEncoder().encode(retainedOutput).byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(retainedOutput).toContain('[output truncated: retention limit reached]');

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/update',
        toolCallId: 'tool-1',
        delta: 'more output that must not grow the retained card',
        runId: 'run-1',
      },
    });
    expect(state.messages[0]?.tools[0]?.output).toBe(retainedOutput);

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/update',
        toolCallId: 'tool-1',
        delta: 'must not replace an explicit empty snapshot',
        runId: 'run-1',
        presentation: {
          kind: 'other',
          title: 'Large output',
          output: { text: '' },
        },
      },
    });
    expect(state.messages[0]?.tools[0]?.output).toBe('');

    const largeStructuredOutput = 'y'.repeat(10 * 1024 * 1024);
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/update',
        toolCallId: 'tool-1',
        delta: '',
        runId: 'run-1',
        presentation: {
          kind: 'other',
          title: 'Large output',
          output: { text: largeStructuredOutput },
        },
      },
    });
    const structuredTool = state.messages[0]?.tools[0];
    expect(new TextEncoder().encode(structuredTool?.output ?? '').byteLength).toBeLessThanOrEqual(
      256 * 1024,
    );
    expect(structuredTool?.presentation?.output?.text).toBe(structuredTool?.output);
    expect(structuredTool?.presentation?.output?.truncated).toBe(true);

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/end',
        toolCallId: 'tool-1',
        isError: false,
        runId: 'run-1',
      },
    });
    expect(state.messages[0]?.tools[0]?.status).toBe('done');
  });

  it('attaches generated media outputs to the owning assistant message', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'assistant-1',
        role: 'assistant',
        runId: 'run-1',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/start',
        toolCallId: 'tool-image',
        toolName: 'image_gen',
        runId: 'run-1',
      },
    });
    const generatedAttachment = {
      id: 'asset-1',
      kind: 'media' as const,
      path: '/tmp/.piwin/media/s1/asset-1.png',
      mimeType: 'image/png',
      byteSize: 256,
      source: 'generated' as const,
    };
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/end',
        toolCallId: 'tool-image',
        isError: false,
        runId: 'run-1',
        attachments: [generatedAttachment],
      },
    });

    expect(state.messages[0]?.attachments).toEqual([generatedAttachment]);

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/end',
        toolCallId: 'tool-image',
        isError: false,
        runId: 'run-1',
        attachments: [generatedAttachment],
      },
    });
    expect(state.messages[0]?.attachments).toHaveLength(1);
  });

  it('preserves image_gen prompt summary when tool/end brings paths JSON', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'assistant-1',
        role: 'assistant',
        runId: 'run-1',
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/start',
        toolCallId: 'tool-image',
        toolName: 'image_gen',
        runId: 'run-1',
        presentation: {
          kind: 'other',
          title: 'image_gen',
          actionVerb: 'Generated image',
          summary: 'Makima tying hair in a bathroom, business attire',
          inputPreview: '{"prompt":"Makima tying hair in a bathroom, business attire"}',
        },
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/end',
        toolCallId: 'tool-image',
        isError: false,
        runId: 'run-1',
        presentation: {
          kind: 'other',
          title: 'image_gen',
          actionVerb: 'Generated image',
          summary: '{ "paths": [ "/Users/me/.piwin/media/session-1/f8d3cd99-537f-42cc-bc5c-b…',
          output: {
            text: '{\n  "paths": ["/Users/me/.piwin/media/session-1/a.png"]\n}',
          },
        },
        attachments: [
          {
            id: 'asset-1',
            kind: 'media',
            path: '/Users/me/.piwin/media/session-1/a.png',
            mimeType: 'image/png',
            byteSize: 128,
            source: 'generated',
          },
        ],
      },
    });

    const tool = state.messages[0]?.tools[0];
    expect(tool?.presentation?.summary).toBe('Makima tying hair in a bathroom, business attire');
    expect(tool?.presentation?.inputPreview).toContain('prompt');
    expect(tool?.presentation?.output?.text).toContain('paths');
    expect(state.messages[0]?.attachments).toHaveLength(1);
  });

  it('does not attach a tool event to another run when ownership is unknown', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'message/start',
        messageId: 'assistant-1',
        role: 'assistant',
        runId: 'run-1',
      },
    });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:00.000Z',
        terminalCode: 'completed',
      }),
    });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-2' });

    const beforeUnknownTool = state;
    const afterUnknownTool = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/start',
        toolCallId: 'tool-from-old-run',
        toolName: 'bash',
        runId: 'run-2',
      },
    });

    expect(afterUnknownTool).toBe(beforeUnknownTool);
    expect(afterUnknownTool.messages[0]?.tools).toHaveLength(0);
  });

  it('keeps a late terminal in its historical record without changing settled global state', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:00.000Z',
        terminalCode: 'completed',
      }),
    });

    const beforeLateTerminal = state;
    const afterLateTerminal = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-legacy', {
        status: 'failed',
        endedAt: '2026-07-24T00:00:01.000Z',
        terminalCode: 'failed',
        error: 'late failure',
      }),
    });

    expect(afterLateTerminal.activeRunId).toBe(beforeLateTerminal.activeRunId);
    expect(afterLateTerminal.lastTerminalRunId).toBe('run-1');
    expect(afterLateTerminal.runTerminal).toMatchObject({ kind: 'complete' });
    expect(afterLateTerminal.runRecordsById['run-legacy']?.outcome).toBe('failed');
  });

  it('keeps partial assistant text on session/aborted and clears run phase', () => {
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
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'partial' },
    });
    state = chatUiReducer(state, { type: 'run/aborting' });
    expect(state.runPhase).toBe('aborting');
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'session/aborted', sessionId: 's1', messageId: 'a1' },
    });
    expect(state.messages[0]?.text).toBe('partial');
    expect(state.messages[0]?.status).toBe('done');
    expect(state.runPhase).toBe('idle');
    expect(state.streaming).toBe(false);
  });

  it('turns a model error into an actionable failed terminal state', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'test' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'error',
        message: 'model-unavailable: cannot switch model',
        retriable: false,
      },
    });

    expect(state.runPhase).toBe('idle');
    expect(state.streaming).toBe(false);
    expect(state.compacting).toBe(false);
    expect(state.runTerminal).toMatchObject({
      kind: 'failed',
      message: 'model-unavailable: cannot switch model',
    });
  });

  it('clears only the transient error message while retaining failed run state', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'error',
      message: 'delete failed',
    });

    state = chatUiReducer(state, { type: 'error/clear' });

    expect(state.error).toBeNull();
    expect(state.runTerminal).toMatchObject({ kind: 'failed', message: 'delete failed' });
  });

  it('stores attachments on user/send', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'see image',
      attachments: [
        {
          id: 'a1',
          kind: 'media',
          path: '/tmp/media/s/a.png',
          mimeType: 'image/png',
          byteSize: 12,
          source: 'paste',
        },
      ],
    });
    expect(state.messages[0]?.attachments).toHaveLength(1);
    expect(state.messages[0]?.attachments[0]?.kind).toBe('media');
    const firstAttachment = state.messages[0]?.attachments[0];
    expect(
      firstAttachment && firstAttachment.kind === 'media' ? firstAttachment.path : '',
    ).toContain('a.png');
  });

  it('keeps explicit Skill provenance on the active prompt until the run ends', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'session/set',
      sessionId: 'skill-session',
    });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: '/writing-plans add auth',
      skill: { skillId: 'writing-plans', name: 'writing-plans' },
    });
    expect(state.activeSkill).toEqual({ skillId: 'writing-plans', name: 'writing-plans' });

    state = chatUiReducer(state, { type: 'error', message: 'skill failed' });
    expect(state.activeSkill).toBeNull();
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

  it('keeps a newer permission prompt when an earlier request resolves', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'permission/show',
      prompt: {
        requestId: 'mcp-connect-first',
        sessionId: 'session-1',
        action: 'mcp:tool-call',
        detail: 'first-server/tool',
        defaultDecision: 'ask',
      },
    });
    state = chatUiReducer(state, {
      type: 'permission/show',
      prompt: {
        requestId: 'mcp-connect-second',
        sessionId: 'session-1',
        action: 'mcp:tool-call',
        detail: 'second-server/tool',
        defaultDecision: 'ask',
      },
    });

    state = chatUiReducer(state, {
      type: 'permission/clear',
      requestId: 'mcp-connect-first',
    });

    expect(state.permissionPrompt?.requestId).toBe('mcp-connect-second');
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
              kind: 'media',
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
    const firstAttachment = state.messages[0]?.attachments[0];
    expect(
      firstAttachment && firstAttachment.kind === 'media' ? firstAttachment.path : '',
    ).toContain('a.png');
    expect(state.messages[1]?.text).toBe('seen');
  });

  it('projects legacy mode wrappers to the user-facing body on hydrate', () => {
    const wrappedUserText = [
      '[piwin-mode:agent]',
      '[piwin-prompt-meta kind="mode:agent" version="2" applies="every-turn"]',
      'Operating contract for this turn:',
      "Success: satisfy the user's stated goal with the smallest correct change.",
      '',
      '---',
      'User:',
      '排查刻度条间距',
    ].join('\n');

    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [
        {
          id: 'u1',
          role: 'user',
          text: wrappedUserText,
          createdAt: new Date().toISOString(),
          status: 'done',
          attachments: [
            {
              id: 'a1',
              kind: 'media',
              path: '/tmp/.piwin/media/s/shot.png',
              mimeType: 'image/png',
              byteSize: 42,
              source: 'paste',
            },
          ],
        },
        {
          id: 'a2',
          role: 'assistant',
          text: 'ok',
          createdAt: new Date().toISOString(),
          status: 'done',
        },
      ],
    });

    expect(state.messages[0]?.text).toBe('排查刻度条间距');
    expect(state.messages[0]?.text).not.toContain('piwin-mode');
    expect(state.messages[0]?.text).not.toContain('Operating contract');
    const media = state.messages[0]?.attachments[0];
    expect(media && media.kind === 'media' ? media.path : '').toContain('shot.png');
    expect(state.messages[1]?.text).toBe('ok');
  });

  it('mapTranscriptMessagesToUi keeps assistant text raw and strips user wrappers', () => {
    const [userMessage, assistantMessage] = mapTranscriptMessagesToUi([
      {
        id: 'u1',
        role: 'user',
        text: '[piwin-mode:agent]\nOperating contract\n\n---\nUser:\nhello',
        createdAt: '2026-08-07T00:00:00.000Z',
        status: 'done',
      },
      {
        id: 'a1',
        role: 'assistant',
        text: 'raw assistant reply with [piwin-mode:agent] mention',
        createdAt: '2026-08-07T00:00:01.000Z',
        status: 'done',
      },
    ]);
    expect(userMessage?.text).toBe('hello');
    expect(assistantMessage?.text).toBe('raw assistant reply with [piwin-mode:agent] mention');
  });

  it('hydrates persisted reasoning boundaries for a fixed thought duration', () => {
    const [assistantMessage] = mapTranscriptMessagesToUi([
      {
        id: 'a-thinking',
        role: 'assistant',
        text: 'answer',
        thinking: 'reasoning',
        createdAt: '2026-08-12T08:00:00.000Z',
        status: 'done',
        thinkingStartedAt: '2026-08-12T08:00:01.000Z',
        thinkingEndedAt: '2026-08-12T08:00:05.000Z',
      },
    ]);

    expect(assistantMessage).toMatchObject({
      thinkingStartedAt: Date.parse('2026-08-12T08:00:01.000Z'),
      thinkingEndedAt: Date.parse('2026-08-12T08:00:05.000Z'),
    });
  });

  it('bounds both canonical and structured tool output during transcript hydrate', () => {
    const largeOutput = 'x'.repeat(10 * 1024 * 1024);
    const [assistantMessage] = mapTranscriptMessagesToUi([
      {
        id: 'a-large-tool',
        role: 'assistant',
        text: 'done',
        createdAt: '2026-08-07T00:00:01.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 'tool-large',
            toolName: 'large-output',
            status: 'done',
            output: largeOutput,
            presentation: {
              kind: 'other',
              title: 'Large output',
              output: { text: largeOutput },
            },
          },
        ],
      },
    ]);

    const tool = assistantMessage?.tools[0];
    expect(new TextEncoder().encode(tool?.output ?? '').byteLength).toBeLessThanOrEqual(256 * 1024);
    expect(tool?.presentation?.output?.text).toBe(tool?.output);
    expect(tool?.presentation?.output?.truncated).toBe(true);
  });

  it('tracks compaction banner state', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'compaction/start' },
    });
    expect(state.compacting).toBe(true);
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'compaction/end', ok: true, message: 'done' },
    });
    expect(state.compacting).toBe(false);
    expect(state.lastCompactionMessage).toBe('done');
  });

  it('stores compaction detail fields without inventing tokens', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
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

  it('updates measured context occupancy after a successful compaction', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'usage/update',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          tokensUsed: 900_000,
          tokensLimit: 1_000_000,
          updatedAt: new Date(0).toISOString(),
          source: 'pi-contextUsage',
        },
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'compaction/end', ok: true, tokensAfter: 120_000 },
    });

    expect(state.contextUsage).toMatchObject({
      tokensUsed: 120_000,
      totalTokens: 120_000,
      contextRatio: 0.12,
      source: 'pi-contextUsage',
    });
  });

  it('stores usage/update on contextUsage', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
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

  it('does not let a host estimate replace measured context usage', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'usage/update',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          totalTokens: 300_726,
          cacheReadTokens: 294_656,
          updatedAt: '2026-08-09T09:47:07.479Z',
          source: 'assistant-usage',
        },
      },
    });
    const measuredState = state;

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'usage/update',
        sessionId: 's1',
        usage: {
          sessionId: 's1',
          totalTokens: 409,
          updatedAt: '2026-08-09T09:47:07.485Z',
          source: 'host-estimate',
        },
      },
    });

    expect(state).toBe(measuredState);
    expect(state.contextUsage?.totalTokens).toBe(300_726);
  });

  it('hydrates context usage with resumed messages and clears it when switching sessions', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's1',
      messages: [],
      contextUsage: {
        sessionId: 's1',
        totalTokens: 505_510,
        cacheReadTokens: 503_680,
        updatedAt: '2026-08-09T11:24:22.004Z',
        source: 'assistant-usage',
      },
    });
    expect(state.contextUsage?.totalTokens).toBe(505_510);

    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 's2',
      awaitTranscript: true,
    });
    expect(state.contextUsage).toBeNull();
  });

  it('ignores stream and usage events from an inactive session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'visible-session' });

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 'background-subagent',
      event: { type: 'message/start', messageId: 'background-message', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 'background-subagent',
      event: {
        type: 'usage/update',
        sessionId: 'background-subagent',
        usage: {
          sessionId: 'background-subagent',
          totalTokens: 999,
          updatedAt: '2026-07-21T00:00:00.000Z',
          source: 'host-estimate',
        },
      },
    });

    expect(state.messages).toEqual([]);
    expect(state.contextUsage).toBeNull();
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

  it('prepends an older transcript page without replacing the active tail', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'paged-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'm3',
          role: 'user',
          text: 'three',
          createdAt: '2026-08-09T00:00:03.000Z',
          status: 'done',
        },
        {
          id: 'm4',
          role: 'assistant',
          text: 'four',
          createdAt: '2026-08-09T00:00:04.000Z',
          status: 'done',
        },
      ],
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 4,
        startIndex: 2,
        endIndex: 4,
        messageBytes: 256,
        olderCursor: 'older-1',
      },
    });
    state = chatUiReducer(state, {
      type: 'session/prepend-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'm1',
          role: 'user',
          text: 'one',
          createdAt: '2026-08-09T00:00:01.000Z',
          status: 'done',
        },
        {
          id: 'm2',
          role: 'assistant',
          text: 'two',
          createdAt: '2026-08-09T00:00:02.000Z',
          status: 'done',
        },
      ],
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 4,
        startIndex: 0,
        endIndex: 2,
        messageBytes: 256,
      },
    });

    expect(state.messages.map((message) => message.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(state.transcriptWindow).toMatchObject({
      revision: 'a'.repeat(64),
      totalCount: 4,
      cacheLimitReached: false,
    });
    expect(state.transcriptWindow?.olderCursor).toBeUndefined();
  });

  it('keeps the live tail separate while a bounded history view is open', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'history-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'history-session',
      messages: [
        {
          id: 'tail-user',
          role: 'user',
          text: 'latest request',
          createdAt: '2026-08-12T00:10:00.000Z',
          status: 'done',
        },
        {
          id: 'tail-assistant',
          role: 'assistant',
          text: 'latest answer',
          createdAt: '2026-08-12T00:10:01.000Z',
          status: 'done',
        },
      ],
    });
    state = chatUiReducer(state, {
      type: 'session/seek-messages',
      sessionId: 'history-session',
      epoch: state.userMessageIndexEpoch,
      messages: [
        {
          id: 'old-user',
          role: 'user',
          text: 'old request',
          createdAt: '2026-08-01T00:00:00.000Z',
          status: 'done',
        },
        {
          id: 'old-assistant',
          role: 'assistant',
          text: 'old answer',
          createdAt: '2026-08-01T00:00:01.000Z',
          status: 'done',
        },
      ],
      window: {
        revision: 'history-revision',
        totalCount: 200,
        startIndex: 20,
        endIndex: 22,
        messageBytes: 256,
        anchorMessageId: 'old-user',
        anchorOffset: 0,
      },
    });

    expect(state.messages.map((message) => message.id)).toEqual(['tail-user', 'tail-assistant']);
    expect(state.historyView?.messages.map((message) => message.id)).toEqual([
      'old-user',
      'old-assistant',
    ]);

    state = chatUiReducer(state, {
      type: 'transcript/append',
      sessionId: 'history-session',
      message: {
        id: 'new-live-message',
        role: 'assistant',
        text: 'arrived while reading history',
        createdAt: '2026-08-12T00:10:02.000Z',
        status: 'done',
      },
    });

    expect(state.messages.at(-1)?.id).toBe('new-live-message');
    expect(state.historyView?.messages.at(-1)?.id).toBe('old-assistant');

    state = chatUiReducer(state, {
      type: 'session/return-to-live',
      sessionId: 'history-session',
    });
    expect(state.historyView).toBeNull();
    expect(state.messages.at(-1)?.id).toBe('new-live-message');
  });

  it('rejects a user-message index response from an invalidated request epoch', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'index-session' });
    const staleEpoch = state.userMessageIndexEpoch;
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'new request',
      clientMessageId: 'new-request',
    });
    state = chatUiReducer(state, {
      type: 'session/user-message-index',
      sessionId: 'index-session',
      epoch: staleEpoch,
      index: {
        sessionId: 'index-session',
        revision: 'stale-index',
        totalUserMessages: 0,
        mode: 'exact',
        anchors: [],
        anchorBytes: 2,
      },
    });

    expect(state.userMessageIndex).toBeNull();
    expect(state.userMessageIndexEpoch).toBeGreaterThan(staleEpoch);
  });

  it('bounds messages appended during a long-lived renderer session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'paged-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: Array.from({ length: 160 }, (_, index) => ({
        id: `m-${index}`,
        role: 'assistant' as const,
        text: `message ${index}`,
        createdAt: `2026-08-09T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
        status: 'done' as const,
      })),
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 200,
        startIndex: 40,
        endIndex: 200,
        messageBytes: 16_000,
        olderCursor: 'older-1',
      },
    });

    state = chatUiReducer(state, {
      type: 'transcript/append',
      sessionId: 'paged-session',
      message: {
        id: 'm-160',
        role: 'assistant',
        text: 'new live-session message',
        createdAt: '2026-08-09T00:03:00.000Z',
        status: 'done',
      },
    });

    expect(state.messages).toHaveLength(160);
    expect(state.messages[0]?.id).toBe('m-1');
    expect(state.messages.at(-1)?.id).toBe('m-160');
    expect(state.transcriptWindow?.cacheLimitReached).toBe(true);
    expect(state.transcriptWindow?.olderCursor).toBeUndefined();
  });

  it('preserves an active partial turn when a stale cursor refreshes the tail', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'paged-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'durable-old',
          role: 'assistant',
          text: 'old tail',
          createdAt: '2026-08-09T00:00:00.000Z',
          status: 'done',
        },
      ],
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 2,
        startIndex: 1,
        endIndex: 2,
        messageBytes: 128,
        olderCursor: 'stale-older',
      },
    });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'current prompt',
      clientMessageId: 'live-user',
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 'paged-session',
      event: { type: 'message/start', messageId: 'live-assistant', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 'paged-session',
      event: {
        type: 'message/text_delta',
        messageId: 'live-assistant',
        delta: 'local partial',
      },
    });

    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'durable-new',
          role: 'assistant',
          text: 'new durable tail',
          createdAt: '2026-08-09T00:01:00.000Z',
          status: 'done',
        },
        {
          id: 'live-assistant',
          role: 'assistant',
          text: 'older persisted prefix',
          createdAt: '2026-08-09T00:02:00.000Z',
          status: 'streaming',
        },
      ],
      transcriptPage: {
        revision: 'b'.repeat(64),
        totalCount: 3,
        startIndex: 1,
        endIndex: 3,
        messageBytes: 256,
      },
      preserveActiveTail: true,
    });

    expect(state.messages.map((message) => message.id)).toEqual([
      'durable-new',
      'live-user',
      'live-assistant',
    ]);
    expect(state.messages.find((message) => message.id === 'live-assistant')?.text).toBe(
      'local partial',
    );
    expect(state.messages.find((message) => message.id === 'live-assistant')?.status).toBe(
      'streaming',
    );
    expect(state.streaming).toBe(true);
    expect(state.runPhase).toBe('streaming');
    expect(state.transcriptWindow?.revision).toBe('b'.repeat(64));
  });

  it('ignores an older transcript page from a different revision', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'paged-session' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'paged-session',
      messages: [],
      transcriptPage: {
        revision: 'a'.repeat(64),
        totalCount: 2,
        startIndex: 0,
        endIndex: 0,
        messageBytes: 2,
      },
    });
    const unchanged = chatUiReducer(state, {
      type: 'session/prepend-messages',
      sessionId: 'paged-session',
      messages: [
        {
          id: 'stale',
          role: 'assistant',
          text: 'stale',
          createdAt: '2026-08-09T00:00:00.000Z',
          status: 'done',
        },
      ],
      transcriptPage: {
        revision: 'b'.repeat(64),
        totalCount: 2,
        startIndex: 0,
        endIndex: 1,
        messageBytes: 128,
      },
    });
    expect(unchanged).toBe(state);
  });

  it('session/remove drops session and clears active transcript when active', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'session/hydrate',
      sessions: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'a' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'a',
      messages: [
        {
          id: 'm1',
          role: 'user',
          text: 'hi',
          createdAt: '2026-07-21T00:00:00.000Z',
          status: 'done',
        },
      ],
    });
    state = chatUiReducer(state, { type: 'session/remove', sessionId: 'a' });
    expect(state.sessions.map((item) => item.id)).toEqual(['b']);
    // Do not auto-select another session after removing the active one.
    expect(state.activeSessionId).toBeNull();
    expect(state.messages).toEqual([]);
  });

  describe('generalSessions (Conversations sidebar section)', () => {
    it('bounded page hydration replaces one scope without deselecting its active transcript', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'older-active' });
      state = chatUiReducer(state, {
        type: 'session/hydrate-page',
        scope: { kind: 'general' },
        sessions: Array.from({ length: 12 }, (_, index) => ({
          id: `page-${index}`,
          name: `Page ${index}`,
        })),
      });

      expect(state.sessionListsWindowed).toBe(true);
      expect(state.sessions).toHaveLength(12);
      expect(state.generalSessions).toHaveLength(12);
      expect(state.activeSessionId).toBe('older-active');
    });

    it('keeps lazy-window list updates bounded and ignores unknown background inserts', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-page',
        scope: { kind: 'general' },
        // Three retained General pages at twelve rows each.
        sessions: Array.from({ length: 36 }, (_, index) => ({
          id: `page-${index}`,
          name: `Page ${index}`,
        })),
      });
      state = chatUiReducer(state, {
        type: 'session/update',
        session: { id: 'background', name: 'Background', scope: { kind: 'general' } },
      });
      expect(state.generalSessions.some((session) => session.id === 'background')).toBe(false);

      state = chatUiReducer(state, { type: 'session/set', sessionId: 'new-active' });
      state = chatUiReducer(state, {
        type: 'session/update',
        session: { id: 'new-active', name: 'New active', scope: { kind: 'general' } },
      });
      expect(state.generalSessions).toHaveLength(36);
      expect(state.generalSessions[0]?.id).toBe('new-active');
    });

    it('session/hydrate-general populates generalSessions without clearing project sessions', () => {
      let state = createInitialChatUiState();
      // Simulate opening a project: project/set clears sessions, then hydrate
      // loads project sessions.
      state = chatUiReducer(state, {
        type: 'project/set',
        path: '/proj',
        trusted: true,
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate',
        sessions: [{ id: 'p1', name: 'Project Session' }],
      });
      // Background hydrate of general sessions should not wipe project sessions.
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          { id: 'g1', name: 'General 1' },
          { id: 'g2', name: 'General 2' },
        ],
      });
      expect(state.sessions.map((item) => item.id)).toEqual(['p1']);
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1', 'g2']);
      expect(state.activeSessionId).toBeNull();
    });

    it('session/hydrate-general mirrors into sessions when general is active scope', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          { id: 'g1', name: 'General 1' },
          { id: 'g2', name: 'General 2' },
        ],
      });
      // activeScope is general by default → sessions should mirror generalSessions.
      expect(state.sessions.map((item) => item.id)).toEqual(['g1', 'g2']);
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1', 'g2']);
    });

    it('session/add prepends to generalSessions when active scope is general', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          {
            id: 'g1',
            name: 'General 1',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });
      state = chatUiReducer(state, {
        type: 'session/add',
        sessionId: 'g2',
        name: 'New General',
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g2', 'g1']);
      expect(state.sessions.map((item) => item.id)).toEqual(['g2', 'g1']);
      // New Conversations rows must carry updatedAt so sort keeps them on top.
      expect(state.generalSessions[0]?.updatedAt).toBeTruthy();
      const newStamp = Date.parse(state.generalSessions[0]?.updatedAt ?? '');
      const oldStamp = Date.parse(state.generalSessions[1]?.updatedAt ?? '');
      expect(newStamp).toBeGreaterThan(oldStamp);
    });

    it('session/add does NOT touch generalSessions when active scope is project', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'General 1' }],
      });
      state = chatUiReducer(state, {
        type: 'project/set',
        path: '/proj',
        trusted: true,
      });
      state = chatUiReducer(state, {
        type: 'session/add',
        sessionId: 'p1',
        name: 'New Project',
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.sessions.map((item) => item.id)).toEqual(['p1']);
    });

    it('session/remove drops from both sessions and generalSessions', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          { id: 'g1', name: 'G1' },
          { id: 'g2', name: 'G2' },
        ],
      });
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'g1' });
      state = chatUiReducer(state, { type: 'session/remove', sessionId: 'g1' });
      expect(state.sessions.map((item) => item.id)).toEqual(['g2']);
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g2']);
    });

    it('session/hydrate-project populates projectSessionsByPath without touching active scope', () => {
      let state = createInitialChatUiState();
      // Active scope is general with its own sessions.
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'General 1' }],
      });
      // Hydrate a non-active project folder.
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/other-proj',
        sessions: [{ id: 'p1', name: 'Other Project Session' }],
      });
      expect(state.projectSessionsByPath['/other-proj']?.map((s) => s.id)).toEqual(['p1']);
      // Active scope sessions and generalSessions must be untouched.
      expect(state.sessions.map((s) => s.id)).toEqual(['g1']);
      expect(state.generalSessions.map((s) => s.id)).toEqual(['g1']);
      expect(state.activeSessionId).toBeNull();
    });

    it('session/hydrate mirrors into projectSessionsByPath for the active project', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'project/set', path: '/proj', trusted: true });
      state = chatUiReducer(state, {
        type: 'session/hydrate',
        sessions: [{ id: 'p1', name: 'Project Session' }],
      });
      expect(state.sessions.map((s) => s.id)).toEqual(['p1']);
      expect(state.projectSessionsByPath['/proj']?.map((s) => s.id)).toEqual(['p1']);
    });

    it('session/remove drops from projectSessionsByPath across all projects', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/proj-a',
        sessions: [{ id: 'shared', name: 'A' }],
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/proj-b',
        sessions: [{ id: 'shared', name: 'B' }],
      });
      state = chatUiReducer(state, { type: 'session/remove', sessionId: 'shared' });
      expect(state.projectSessionsByPath['/proj-a']).toEqual([]);
      expect(state.projectSessionsByPath['/proj-b']).toEqual([]);
    });

    it('project/set and project/clear preserve generalSessions', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'G1' }],
      });
      state = chatUiReducer(state, {
        type: 'project/set',
        path: '/proj',
        trusted: true,
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.sessions).toEqual([]);

      state = chatUiReducer(state, { type: 'project/clear' });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.sessions).toEqual([]);
    });

    it('session/clear-active enters draft mode (null activeSessionId, cleared messages)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'G1' }],
      });
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'g1' });
      state = chatUiReducer(state, {
        type: 'session/load-messages',
        sessionId: 'g1',
        messages: [
          {
            id: 'm1',
            role: 'user',
            text: 'hi',
            thinking: '',
            tools: [],
            attachments: [],
            status: 'done',
            createdAt: new Date().toISOString(),
          },
        ],
        contextUsage: {
          sessionId: 'g1',
          tokensUsed: 8_276,
          updatedAt: '2026-08-11T10:21:36.342Z',
          source: 'assistant-usage',
        },
      });
      expect(state.activeSessionId).toBe('g1');
      expect(state.messages).toHaveLength(1);
      expect(state.contextUsage?.tokensUsed).toBe(8_276);

      // session/clear-active is the "New session" (draft mode) action.
      state = chatUiReducer(state, { type: 'session/clear-active' });
      expect(state.activeSessionId).toBe(null);
      expect(state.contextUsage).toBeNull();
      expect(state.messages).toEqual([]);
      expect(state.outline).toEqual([]);
      expect(state.activeSessionArchived).toBe(false);
      expect(state.runPhase).toBe('idle');
      expect(state.streaming).toBe(false);
      // Sidebar list is preserved — only the active session is cleared.
      expect(state.sessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
    });

    it('session/update does not insert a project session into generalSessions when general is active', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [{ id: 'g1', name: 'General 1', scope: { kind: 'general' } }],
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/proj',
        sessions: [
          {
            id: 'p1',
            name: 'Project Session',
            scope: { kind: 'project', projectPath: '/proj' },
          },
        ],
      });
      // Simulate a name-updated push while Conversations (general) is active.
      state = chatUiReducer(state, {
        type: 'session/update',
        session: {
          id: 'p1',
          name: 'Renamed Project',
          scope: { kind: 'project', projectPath: '/proj' },
        },
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g1']);
      expect(state.projectSessionsByPath['/proj']?.map((item) => item.id)).toEqual(['p1']);
      expect(state.projectSessionsByPath['/proj']?.[0]?.name).toBe('Renamed Project');
      // Active general list must not gain the project row either.
      expect(state.sessions.map((item) => item.id)).toEqual(['g1']);
    });

    it('session/update rehomes a dual-listed project row out of Conversations', () => {
      let state = createInitialChatUiState();
      // Corrupt dual listing: same id under general and a project folder.
      state = chatUiReducer(state, {
        type: 'session/hydrate-general',
        sessions: [
          {
            id: 'shared',
            name: '继续',
            scope: { kind: 'general' },
          },
        ],
      });
      state = chatUiReducer(state, {
        type: 'session/hydrate-project',
        projectPath: '/Users/dev/piwin',
        sessions: [
          {
            id: 'shared',
            name: '继续',
            scope: { kind: 'project', projectPath: '/Users/dev/piwin' },
          },
        ],
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['shared']);
      // Authoritative project scope from host clears the Conversations copy.
      state = chatUiReducer(state, {
        type: 'session/update',
        session: {
          id: 'shared',
          name: '继续',
          scope: { kind: 'project', projectPath: '/Users/dev/piwin' },
        },
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual([]);
      expect(state.projectSessionsByPath['/Users/dev/piwin']?.map((item) => item.id)).toEqual([
        'shared',
      ]);
      expect(state.sessions.map((item) => item.id)).toEqual([]);
    });
  });

  describe('C1: envelope-based dedup', () => {
    const makeEnvelope = (eventId: string, sequence: number, runId?: string) => ({
      eventId,
      sequence,
      runId,
    });

    it('rejects an event with a replayed envelope eventId', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
        envelope: makeEnvelope('evt-1', 1),
      } as never);

      const afterReplay = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
        envelope: makeEnvelope('evt-1', 1),
      } as never);

      expect(state.messages).toHaveLength(1);
      expect(afterReplay).toBe(state);
    });

    it('rejects a stale event with a lower sequence number', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
        envelope: makeEnvelope('evt-1', 5, 'run-1'),
      } as never);

      const afterStale = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'stale payload' },
        envelope: makeEnvelope('evt-2', 3, 'run-1'),
      } as never);

      expect(afterStale).toBe(state);
    });

    it('accepts events without envelope (backward compatible)', () => {
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
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'no envelope' },
      });

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]?.text).toBe('no envelope');
    });

    it('never deduplicates based on equal delta text when envelopes differ', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
        envelope: makeEnvelope('evt-1', 1, 'run-1'),
      } as never);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'same ' },
        envelope: makeEnvelope('evt-2', 2, 'run-1'),
      } as never);
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'same ' },
        envelope: makeEnvelope('evt-3', 3, 'run-1'),
      } as never);

      // Identical delta text must accumulate when envelopes are distinct.
      expect(state.messages[0]?.text).toBe('same same ');
    });

    it('preserves existing message/start idempotency check', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      const startEvent = {
        type: 'message/start' as const,
        messageId: 'dup-id',
        role: 'assistant' as const,
      };
      state = chatUiReducer(state, { type: 'event', sessionId: 's1', event: startEvent });
      state = chatUiReducer(state, { type: 'event', sessionId: 's1', event: startEvent });

      expect(state.messages).toHaveLength(1);
    });
  });

  describe('C1: message/text_snapshot', () => {
    it('replaces message text instead of appending', () => {
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
        event: { type: 'message/text_delta', messageId: 'a1', delta: 'old ' },
      });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: { type: 'message/text_snapshot', messageId: 'a1', text: 'complete replacement' },
      });

      expect(state.messages[0]?.text).toBe('complete replacement');
    });

    it('does not create a missing message row', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'message/text_snapshot',
          messageId: 'unknown-message',
          text: 'should be ignored',
        },
      });

      expect(state.messages).toHaveLength(0);
    });
  });

  describe('subagent children + streams', () => {
    it('upserts subagent/updated into subagentChildren for the active parent', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      state = chatUiReducer(state, {
        type: 'subagent/updated',
        parentSessionId: 'parent-1',
        child: {
          id: 'child-1',
          scope: { kind: 'project', projectPath: '/p' },
          projectPath: '/p',
          workingDirectory: '/p',
          updatedAt: '2026-08-01T00:00:00.000Z',
          messageCount: 0,
          kind: 'subagent',
          depth: 1,
          subagentStatus: 'done',
          parentSessionId: 'parent-1',
        },
      });
      expect(state.subagentChildren['child-1']).toMatchObject({ subagentStatus: 'done' });
    });

    it('replaces a previous child summary on later subagent/updated', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      const child = (subagentStatus: 'running' | 'done') => ({
        id: 'child-1',
        scope: { kind: 'project', projectPath: '/p' } as const,
        projectPath: '/p',
        workingDirectory: '/p',
        updatedAt: '2026-08-01T00:00:00.000Z',
        messageCount: 0,
        kind: 'subagent' as const,
        depth: 1,
        subagentStatus,
        parentSessionId: 'parent-1',
      });
      state = chatUiReducer(state, {
        type: 'subagent/updated',
        parentSessionId: 'parent-1',
        child: child('running'),
      });
      state = chatUiReducer(state, {
        type: 'subagent/updated',
        parentSessionId: 'parent-1',
        child: child('done'),
      });
      expect(state.subagentChildren['child-1']).toMatchObject({ subagentStatus: 'done' });
      expect(Object.keys(state.subagentChildren)).toHaveLength(1);
    });

    it('clear-stream removes only the targeted child stream', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
      state = chatUiReducer(state, {
        type: 'subagent/stream',
        parentSessionId: 'parent-1',
        childSessionId: 'child-1',
        event: { type: 'message/start', messageId: 'm1', role: 'assistant' },
      });
      state = chatUiReducer(state, {
        type: 'subagent/stream',
        parentSessionId: 'parent-1',
        childSessionId: 'child-2',
        event: { type: 'message/start', messageId: 'm2', role: 'assistant' },
      });
      state = chatUiReducer(state, { type: 'subagent/clear-stream', childSessionId: 'child-1' });
      expect(state.subagentStreams['child-1']).toBeUndefined();
      expect(state.subagentStreams['child-2']).toBeDefined();
    });
  });

  describe('walkthrough artifacts', () => {
    function readyArtifact(messageId: string): import('@piwin/contracts').WalkthroughArtifact {
      return {
        version: 1,
        id: `wt-${messageId}`,
        sessionId: 's1',
        messageId,
        mode: 'default',
        model: { protocol: 'openai-compatible', providerId: 'mock', modelId: 'mock-wt' },
        sourceHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'ready',
        markdown: '# Walkthrough',
        generatedAt: '2026-01-01T00:00:00.000Z',
      };
    }

    it('walkthrough/hydrate replaces the map keyed by messageId', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1'), readyArtifact('a2')],
      });
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(2);
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('ready');
      expect(state.walkthroughsByMessageId['a2']?.status).toBe('ready');
    });

    it('walkthrough/updated upserts an artifact by messageId', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: {
          version: 1,
          id: 'wt-a1',
          sessionId: 's1',
          messageId: 'a1',
          mode: 'default',
          sourceHash: 'hash',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          status: 'generating',
          generationId: 'gen-1',
        },
      });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
      // Upsert to ready.
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: readyArtifact('a1'),
      });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('ready');
    });

    function generatingArtifact(
      messageId: string,
      generationId: string,
    ): import('@piwin/contracts').WalkthroughArtifact {
      return {
        version: 1,
        id: `wt-${messageId}`,
        sessionId: 's1',
        messageId,
        mode: 'default',
        sourceHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'generating',
        generationId,
      };
    }

    it('walkthrough/updated accepts a generating push against a terminal (ready) artifact (force regeneration)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: readyArtifact('a1') });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-2'),
      });
      // A fresh generating push (new generationId) on a ready artifact is a
      // regeneration request and must be accepted so the UI shows "Generating...".
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
    });

    it('walkthrough/updated accepts a generating push against a terminal (error) artifact (force regeneration)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      const errorArtifact: import('@piwin/contracts').WalkthroughArtifact = {
        version: 1,
        id: 'wt-a1',
        sessionId: 's1',
        messageId: 'a1',
        mode: 'default',
        sourceHash: 'hash',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        status: 'error',
        error: { code: 'empty-output', message: 'no output' },
        generatedAt: '2026-01-01T00:00:00.000Z',
      };
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: errorArtifact });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-2'),
      });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
    });

    it('walkthrough/updated drops a stale generating push from an older generation', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-1'),
      });
      // A late generating push with a different generationId is stale.
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-late'),
      });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
      expect((state.walkthroughsByMessageId['a1'] as { generationId: string }).generationId).toBe(
        'gen-1',
      );
    });

    it('walkthrough/updated accepts a generating push with the same generationId (update)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-1'),
      });
      const updated = {
        ...generatingArtifact('a1', 'gen-1'),
        updatedAt: '2026-01-02T00:00:00.000Z',
      };
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: updated });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('generating');
      expect(state.walkthroughsByMessageId['a1']?.updatedAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it('walkthrough/updated always accepts a terminal (ready) push over a generating artifact', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/updated',
        artifact: generatingArtifact('a1', 'gen-1'),
      });
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: readyArtifact('a1') });
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('ready');
    });

    it('walkthrough/updated ignores an artifact whose sessionId differs from the active session', () => {
      // Cross-session leak guard: a walkthrough generation that completes for
      // session B after the user switched to session A must not leak into A.
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'sA' });
      const staleArtifact = {
        ...readyArtifact('a1'),
        sessionId: 'sB',
      };
      state = chatUiReducer(state, { type: 'walkthrough/updated', artifact: staleArtifact });
      expect('a1' in state.walkthroughsByMessageId).toBe(false);
    });

    it('walkthrough/remove deletes an artifact by messageId', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1')],
      });
      state = chatUiReducer(state, { type: 'walkthrough/remove', messageId: 'a1' });
      expect('a1' in state.walkthroughsByMessageId).toBe(false);
    });

    it('session switch clears the walkthrough map', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1')],
      });
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(1);
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(0);
    });

    it('session/load-messages does NOT clear the walkthrough map (hydrate race)', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1')],
      });
      state = chatUiReducer(state, {
        type: 'session/load-messages',
        sessionId: 's1',
        messages: [
          {
            id: 'u1',
            role: 'user',
            text: 'hi',
            createdAt: '2026-01-01T00:00:00.000Z',
            status: 'done',
          },
        ],
      });
      // load-messages must not wipe a freshly-hydrated walkthrough map; the
      // map is cleared by session/set which fires before load-messages.
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(1);
      expect(state.walkthroughsByMessageId['a1']?.status).toBe('ready');
    });

    it('scope/set clears the walkthrough map', () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
      state = chatUiReducer(state, {
        type: 'walkthrough/hydrate',
        artifacts: [readyArtifact('a1')],
      });
      state = chatUiReducer(state, {
        type: 'scope/set',
        scope: { kind: 'project', projectPath: '/tmp' },
      });
      expect(Object.keys(state.walkthroughsByMessageId)).toHaveLength(0);
    });
  });
});

describe('chatUiReducer subagent hydration', () => {
  const childSummary = (id: string, parentSessionId: string) => ({
    id,
    scope: { kind: 'project' as const, projectPath: '/workspace' },
    workingDirectory: '/workspace',
    projectPath: '/workspace',
    updatedAt: '2026-08-03T00:00:00.000Z',
    messageCount: 0,
    parentSessionId,
    kind: 'subagent' as const,
  });
  const invocation = (id: string, revision: number) => ({
    id,
    parentSessionId: 'parent-1',
    runId: 'batch-1',
    parentRunId: 'parent-run',
    parentToolCallId: `tool-${id}`,
    taskId: `task-${id}`,
    task: 'same task text',
    status: 'running' as const,
    activity: { kind: 'thinking' as const },
    revision,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  });

  it('hydrates children only for the active parent session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });

    state = chatUiReducer(state, {
      type: 'subagent/children-hydrate',
      parentSessionId: 'parent-1',
      children: [childSummary('child-1', 'parent-1')],
    });
    expect(state.subagentChildren['child-1']?.id).toBe('child-1');

    const beforeStaleHydrate = state;
    const afterStaleHydrate = chatUiReducer(state, {
      type: 'subagent/children-hydrate',
      parentSessionId: 'parent-other',
      children: [childSummary('child-2', 'parent-other')],
    });
    expect(afterStaleHydrate).toBe(beforeStaleHydrate);
  });

  it('merges a hydrate over existing entries without dropping unrelated children', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
    state = chatUiReducer(state, {
      type: 'subagent/children-hydrate',
      parentSessionId: 'parent-1',
      children: [childSummary('child-1', 'parent-1')],
    });
    state = chatUiReducer(state, {
      type: 'subagent/children-hydrate',
      parentSessionId: 'parent-1',
      children: [
        { ...childSummary('child-1', 'parent-1'), name: 'updated' },
        childSummary('child-2', 'parent-1'),
      ],
    });
    expect(state.subagentChildren['child-1']?.name).toBe('updated');
    expect(state.subagentChildren['child-2']?.id).toBe('child-2');
  });

  it('hydrates independent invocations and ignores stale revisions', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
    state = chatUiReducer(state, {
      type: 'subagent/invocations-hydrate',
      parentSessionId: 'parent-1',
      invocations: [invocation('one', 2), invocation('two', 1)],
    });
    state = chatUiReducer(state, {
      type: 'subagent/invocation-updated',
      parentSessionId: 'parent-1',
      invocation: { ...invocation('one', 1), status: 'failed' },
    });

    expect(state.subagentInvocations.one?.revision).toBe(2);
    expect(state.subagentInvocations.one?.status).toBe('running');
    expect(state.subagentInvocations.two?.parentToolCallId).toBe('tool-two');
  });

  it('ignores subagent/updated pushes for a non-active parent', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
    const beforeStalePush = state;
    const afterStalePush = chatUiReducer(state, {
      type: 'subagent/updated',
      parentSessionId: 'parent-other',
      child: childSummary('child-x', 'parent-other'),
    });
    expect(afterStalePush).toBe(beforeStalePush);
  });

  it('clears subagent maps when switching sessions', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
    state = chatUiReducer(state, {
      type: 'subagent/children-hydrate',
      parentSessionId: 'parent-1',
      children: [childSummary('child-1', 'parent-1')],
    });
    state = chatUiReducer(state, {
      type: 'subagent/stream',
      parentSessionId: 'parent-1',
      childSessionId: 'child-1',
      event: { type: 'message/start', messageId: 'm1', role: 'assistant' },
    });
    state = chatUiReducer(state, {
      type: 'subagent/invocations-hydrate',
      parentSessionId: 'parent-1',
      invocations: [invocation('one', 1)],
    });
    expect(Object.keys(state.subagentStreams)).toHaveLength(1);

    state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-2' });
    expect(Object.keys(state.subagentChildren)).toHaveLength(0);
    expect(Object.keys(state.subagentStreams)).toHaveLength(0);
    expect(Object.keys(state.subagentInvocations)).toHaveLength(0);
  });

  it('uses clientMessageId for optimistic user bubbles and rolls them back', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'hello',
      clientMessageId: 'client-user-1',
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.id).toBe('client-user-1');
    expect(state.streaming).toBe(true);

    state = chatUiReducer(state, {
      type: 'user/send-rollback',
      clientMessageId: 'client-user-1',
    });
    expect(state.messages).toHaveLength(0);
    expect(state.streaming).toBe(false);
    expect(state.runPhase).toBe('idle');
  });

  it('places steer text in the chain without replacing the active run', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'Initial prompt' });
    state = chatUiReducer(state, {
      type: 'run/accepted',
      runId: 'run-1',
      acceptedAt: '2026-08-09T00:00:00.000Z',
    });

    state = chatUiReducer(state, {
      type: 'user/steer',
      text: 'Use the smaller fix',
      clientMessageId: 'steer-client-1',
    });

    expect(state.messages.at(-1)).toMatchObject({
      id: 'steer-client-1',
      role: 'user',
      text: 'Use the smaller fix',
    });
    expect(state.activeRunId).toBe('run-1');
    expect(state.runPhase).toBe('streaming');
    expect(state.streaming).toBe(true);
  });

  it('preserves paint-first optimistic draft bubbles when session/set activates a new session', () => {
    let state = createInitialChatUiState();
    expect(state.activeSessionId).toBeNull();
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'first message',
      clientMessageId: 'client-user-draft',
    });
    expect(state.messages).toHaveLength(1);
    expect(state.streaming).toBe(true);

    state = chatUiReducer(state, { type: 'session/set', sessionId: 'new-session' });
    expect(state.activeSessionId).toBe('new-session');
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.id).toBe('client-user-draft');
    expect(state.streaming).toBe(true);
    expect(state.workingSessionIds).toEqual({ 'new-session': true });
  });

  it('still clears messages when switching without awaitTranscript (cold target)', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'keep me' });
    // Non-resume session/set (no awaitTranscript): cold target paints empty,
    // but the left session is stashed in the warm LRU.
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    expect(state.activeSessionId).toBe('s2');
    expect(state.awaitingTranscript).toBe(false);
    expect(state.messages).toHaveLength(0);
    expect(state.streaming).toBe(false);
    expect(state.warmSessionCache.byId.s1?.messages[0]?.text).toContain('keep me');
  });

  it('cold switch keeps previous while loading; warm hit restores the target session', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'from s1' });
    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 's2',
      awaitTranscript: true,
    });
    // Cold s2: keep s1 rows under loading (no empty vignette flash).
    expect(state.messages.some((message) => message.text.includes('from s1'))).toBe(true);
    expect(state.warmSessionCache.byId.s1?.messages[0]?.text).toContain('from s1');
    expect(state.awaitingTranscript).toBe(true);

    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 's2',
      messages: [
        {
          id: 's2-u',
          role: 'user',
          text: 'from s2',
          createdAt: new Date(0).toISOString(),
        } as never,
      ],
      live: false,
    });
    expect(state.messages.some((message) => message.text.includes('from s2'))).toBe(true);

    // Switch back to s1 — warm hit restores s1; s1 leaves the warm set (promoted).
    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 's1',
      awaitTranscript: true,
    });
    expect(state.warmSessionCache.order).toContain('s2');
    expect(state.warmSessionCache.byId.s1).toBeUndefined();
    expect(state.messages.some((message) => message.text.includes('from s1'))).toBe(true);
    expect(state.messages.some((message) => message.text.includes('from s2'))).toBe(false);
  });

  it('evicts oldest inactive warm when a third left session is stashed', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'one' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's2' });
    state = chatUiReducer(state, { type: 'user/send', text: 'two' });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's3' });
    state = chatUiReducer(state, { type: 'user/send', text: 'three' });
    // Leave s3 for s4 → warm holds s2,s3 (s1 evicted); active is empty s4.
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's4' });
    expect(state.warmSessionCache.order).toEqual(['s2', 's3']);
    expect(state.warmSessionCache.byId.s1).toBeUndefined();
    expect(state.messages).toHaveLength(0);
  });
});
