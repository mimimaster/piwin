import { describe, expect, it } from 'vitest';
import {
  chatUiReducer,
  createInitialChatUiState,
  mapTranscriptMessagesToUi,
} from './chat-reducer';
import { makeRun } from './chat-reducer-test-harness';

describe('chatUiReducer events (late stream)', () => {
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

  it('still appends same-run deltas that race past run/terminal', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
    });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'completed',
        endedAt: '2026-07-24T00:00:00.000Z',
        terminalCode: 'completed',
      }),
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'late tokens', runId: 'run-1' },
    });

    expect(state.messages[0]?.text).toBe('late tokens');
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
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});
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

  it('re-enables a live run after Stop fails to reach Host', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'go' });
    expect(state.runPhase).toBe('streaming');
    state = chatUiReducer(state, { type: 'run/aborting' });
    expect(state.runPhase).toBe('aborting');
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});
    state = chatUiReducer(state, { type: 'run/abort-failed' });
    expect(state.runPhase).toBe('streaming');
    expect(state.streaming).toBe(true);
  });

  it('stops live activity optimistically and restores it when Pause fails', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'go' });
    state = chatUiReducer(state, { type: 'run/pausing' });
    expect(state.runPhase).toBe('pausing');
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});

    state = chatUiReducer(state, { type: 'run/pause-failed' });
    expect(state.runPhase).toBe('streaming');
    expect(state.streaming).toBe(true);
    expect(state.workingSessionIds).toEqual({ s1: true });
  });

  it('projects Host pausing without leaving the sidebar activity spinning', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'run/updated',
      run: makeRun('run-1', { status: 'cancelling', phase: 'pausing' }),
    });

    expect(state.runPhase).toBe('pausing');
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});
  });

  it('does not revive the sidebar spinner on a plain cancelling Stop projection', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'go' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    expect(state.workingSessionIds).toEqual({ s1: true });
    state = chatUiReducer(state, {
      type: 'run/updated',
      run: makeRun('run-1', { status: 'cancelling' }),
    });

    expect(state.runPhase).toBe('aborting');
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});
  });

  it('keeps optimistic Pause chrome when Host still reports the run as running', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
    });
    state = chatUiReducer(state, { type: 'run/pausing' });
    expect(state.runPhase).toBe('pausing');
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});

    state = chatUiReducer(state, {
      type: 'run/updated',
      run: makeRun('run-1', { status: 'running', phase: 'streaming' }),
    });
    expect(state.runPhase).toBe('pausing');
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'a1', runId: 'run-1' },
    });
    expect(state.runPhase).toBe('pausing');
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a2', role: 'assistant', runId: 'run-1' },
    });
    expect(state.messages.some((message) => message.id === 'a2')).toBe(true);
    expect(state.runPhase).toBe('pausing');
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});
  });

  it('keeps the provider model on the assistant row after streaming ends', () => {
    const turnModel = {
      protocol: 'openai-compatible' as const,
      providerId: 'custom-openai',
      modelId: 'win/glm5.2',
    };
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'stream please',
      model: turnModel,
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant' },
    });
    expect(state.messages.find((message) => message.id === 'a1')?.model).toEqual(turnModel);

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'hello' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/end', messageId: 'a1' },
    });

    expect(state.messages.find((message) => message.id === 'a1')).toMatchObject({
      status: 'done',
      text: 'hello',
      model: turnModel,
    });
  });

  it('swallows The operation was aborted during pause instead of failing the turn', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/text_delta', messageId: 'a1', delta: 'partial', runId: 'run-1' },
    });
    state = chatUiReducer(state, { type: 'run/pausing' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'error',
        message: 'The operation was aborted',
        runId: 'run-1',
      },
    });

    expect(state.error).toBeNull();
    expect(state.runPhase).toBe('pausing');
    expect(state.streaming).toBe(false);
    expect(state.workingSessionIds).toEqual({});
    expect(state.runTerminal.kind).toBe('none');
    expect(state.messages.find((message) => message.id === 'a1')).toMatchObject({
      text: 'partial',
      status: 'streaming',
    });
  });

  it('attaches Agent error evidence without terminalizing the Run', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'test' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'error',
        message: 'model-unavailable: cannot switch model',
        retriable: false,
        runId: 'run-1',
        failure: {
          code: 'provider-unavailable',
          origin: 'provider',
          message: 'model-unavailable: cannot switch model',
          retriable: false,
        },
      },
    });

    expect(state.activeRunId).toBe('run-1');
    expect(state.runTerminal.kind).toBe('none');
    expect(state.messages.find((message) => message.id === 'a1')).toMatchObject({
      status: 'streaming',
      error: 'model-unavailable: cannot switch model',
      failure: { code: 'provider-unavailable' },
    });
  });

  it('stamps a done empty assistant when the error arrives after run/terminal', () => {
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
      event: { type: 'message/end', messageId: 'assistant-1', runId: 'run-1' },
    });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-1', {
        status: 'failed',
        endedAt: '2026-08-21T07:30:49.700Z',
        error: 'The model produced no response.',
      }),
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'error',
        message: 'The model produced no response.',
        retriable: true,
        runId: 'run-1',
      },
    });

    expect(state.messages).toEqual([
      expect.objectContaining({
        id: 'assistant-1',
        status: 'error',
        error: 'The model produced no response.',
      }),
    ]);
    expect(state.runTerminal).toMatchObject({
      kind: 'failed',
      message: 'The model produced no response.',
    });
  });

  it('creates an error bubble when run/terminal fails with no assistant row', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'user/send', text: 'ping' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-silent' });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-silent', {
        status: 'failed',
        endedAt: '2026-08-21T07:30:49.700Z',
        error: 'No endpoints available',
      }),
    });

    expect(state.messages.some((message) => message.role === 'user')).toBe(true);
    expect(state.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          status: 'error',
          error: 'No endpoints available',
          runId: 'run-silent',
        }),
      ]),
    );
  });

  it('maps transcript terminalMessage and structured failure for resume', () => {
    const [message] = mapTranscriptMessagesToUi([
      {
        id: 'assistant-fail',
        role: 'assistant',
        text: '',
        status: 'error',
        createdAt: '2026-08-21T07:30:49.000Z',
        terminalMessage: 'No endpoints available matching your guardrail',
        failure: {
          code: 'provider-unavailable',
          origin: 'provider',
          message: 'No endpoints available matching your guardrail',
          retriable: true,
        },
      },
    ]);
    expect(message).toMatchObject({
      status: 'error',
      error: 'No endpoints available matching your guardrail',
      failure: { code: 'provider-unavailable' },
    });
  });

  it('clears a local error toast without inventing a Run terminal', () => {
    let state = chatUiReducer(createInitialChatUiState(), {
      type: 'error',
      message: 'delete failed',
    });

    expect(state.error).toBe('delete failed');
    expect(state.runTerminal.kind).toBe('none');
    state = chatUiReducer(state, { type: 'error/clear' });

    expect(state.error).toBeNull();
    expect(state.runTerminal.kind).toBe('none');
  });

  it('drops identity-less Agent errors instead of guessing the live Run', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-1' },
    });
    const before = state;
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'error', message: 'provider exploded' },
    });
    expect(state.messages).toBe(before.messages);
    expect(state.runTerminal.kind).toBe('none');
    expect(state.activeRunId).toBe('run-1');
  });

  it('reconciles a lost terminal push from Host Run authority', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-lost' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-lost' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'error',
        message: 'model-stream-stalled',
        runId: 'run-lost',
        failure: {
          code: 'model-stream-stalled',
          origin: 'transport',
          message: 'model-stream-stalled',
          retriable: true,
        },
      },
    });
    expect(state.runTerminal.kind).toBe('none');
    expect(state.messages.find((message) => message.id === 'a1')).toMatchObject({
      status: 'streaming',
      error: 'model-stream-stalled',
    });

    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-lost', {
        status: 'failed',
        endedAt: '2026-08-27T07:30:49.700Z',
        error: 'model-stream-stalled',
        failure: {
          code: 'model-stream-stalled',
          origin: 'transport',
          message: 'model-stream-stalled',
          retriable: true,
        },
      }),
    });
    expect(state.activeRunId).toBeNull();
    expect(state.runTerminal).toMatchObject({
      kind: 'failed',
      message: 'model-stream-stalled',
    });
    expect(state.messages.find((message) => message.id === 'a1')).toMatchObject({
      status: 'error',
      error: 'model-stream-stalled',
      failure: { code: 'model-stream-stalled' },
    });
  });

  it('does not show a provider abort after a cancelled or paused Run', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-stop' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-stop' },
    });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-stop', {
        status: 'cancelled',
        endedAt: '2026-08-27T07:30:49.700Z',
      }),
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'error',
        message: 'The operation was aborted',
        runId: 'run-stop',
      },
    });
    expect(state.runTerminal.kind).toBe('stopped');
    expect(state.messages.find((message) => message.id === 'a1')?.error).toBeUndefined();

    state = chatUiReducer(createInitialChatUiState(), { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-pause' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-pause' },
    });
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-pause', {
        status: 'interrupted',
        terminalCode: 'paused',
        endedAt: '2026-08-27T07:30:49.700Z',
        resumeCheckpointId: 'ckpt-1',
      }),
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'error',
        message: 'AbortError: The operation was aborted',
        runId: 'run-pause',
      },
    });
    expect(state.runTerminal.kind).toBe('paused');
    expect(state.messages.find((message) => message.id === 'a1')?.error).toBeUndefined();
  });

  it('shows native retry without a duplicate error card and clears it on success', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-retry' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'a1', role: 'assistant', runId: 'run-retry' },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'error',
        message: 'Stream ended without finish_reason',
        runId: 'run-retry',
        failure: {
          code: 'model-stream-missing-finish',
          origin: 'protocol',
          message: 'Stream ended without finish_reason',
          retriable: true,
        },
      },
    });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'model/retry',
        phase: 'waiting',
        attempt: 1,
        maxAttempts: 3,
        delayMs: 250,
        runId: 'run-retry',
      },
    });
    expect(state.activeRunPhase).toBe('connecting-model');
    expect(state.runTerminal.kind).toBe('none');
    expect(state.messages.find((message) => message.id === 'a1')).toMatchObject({
      status: 'streaming',
    });

    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-retry', {
        status: 'completed',
        endedAt: '2026-08-27T07:30:49.700Z',
      }),
    });
    expect(state.activeRunPhase).toBeNull();
    expect(state.runTerminal.kind).toBe('complete');
    expect(state.messages.find((message) => message.id === 'a1')?.error).toBeUndefined();
    expect(state.messages.find((message) => message.id === 'a1')?.failure).toBeUndefined();
  });

  it('clears native retry status when the final Host outcome is failed', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-retry-fail' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'model/retry',
        phase: 'attempting',
        attempt: 2,
        runId: 'run-retry-fail',
      },
    });
    expect(state.activeRunPhase).toBe('connecting-model');
    state = chatUiReducer(state, {
      type: 'run/terminal',
      run: makeRun('run-retry-fail', {
        status: 'failed',
        endedAt: '2026-08-27T07:30:49.700Z',
        error: 'retry budget exhausted',
        failure: {
          code: 'model-stream-missing-finish',
          origin: 'protocol',
          message: 'retry budget exhausted',
          retriable: false,
        },
      }),
    });
    expect(state.activeRunPhase).toBeNull();
    expect(state.runTerminal.kind).toBe('failed');
    expect(state.messages.some((message) => message.status === 'error')).toBe(true);
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
});
