import { describe, expect, it } from 'vitest';
import { chatUiReducer, createInitialChatUiState } from './chat-reducer';

describe('chatUiReducer', () => {
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
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'run/terminal',
        sessionId: 's1',
        runId: 'run-1',
        outcome: 'completed',
        at: '2026-07-24T00:00:00.000Z',
      },
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
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'run/phase',
        sessionId: 's1',
        runId: 'run-1',
        phase: 'waiting-first-token',
        at: '2026-07-24T00:00:01.000Z',
      },
    });
    expect(state.activeRunPhase).toBe('waiting-first-token');
    expect(state.activeRunId).toBe('run-1');

    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'run/terminal',
        sessionId: 's1',
        runId: 'run-1',
        outcome: 'completed',
        at: '2026-07-24T00:00:02.000Z',
      },
    });
    expect(state.activeRunId).toBeNull();
    expect(state.activeRunPhase).toBeNull();
    expect(state.activeRunStartedAt).toBeNull();
  });

  it('rejects a legacy delta after the run has terminated', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'run/terminal',
        sessionId: 's1',
        runId: 'run-1',
        outcome: 'completed',
        at: '2026-07-24T00:00:00.000Z',
      },
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
        type: 'tool/end',
        toolCallId: 'tool-1',
        isError: false,
        runId: 'run-1',
      },
    });
    expect(state.messages[0]?.tools[0]?.status).toBe('done');
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
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'run/terminal',
        sessionId: 's1',
        runId: 'run-1',
        outcome: 'completed',
        at: '2026-07-24T00:00:00.000Z',
      },
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
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'run/terminal',
        sessionId: 's1',
        runId: 'run-1',
        outcome: 'completed',
        at: '2026-07-24T00:00:00.000Z',
      },
    });

    const beforeLateTerminal = state;
    const afterLateTerminal = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'run/terminal',
        sessionId: 's1',
        runId: 'run-legacy',
        outcome: 'failed',
        at: '2026-07-24T00:00:01.000Z',
        message: 'late failure',
      },
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
        sessions: [{ id: 'g1', name: 'General 1' }],
      });
      state = chatUiReducer(state, {
        type: 'session/add',
        sessionId: 'g2',
        name: 'New General',
      });
      expect(state.generalSessions.map((item) => item.id)).toEqual(['g2', 'g1']);
      expect(state.sessions.map((item) => item.id)).toEqual(['g2', 'g1']);
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
});
