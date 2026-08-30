import { describe, expect, it } from 'vitest';
import {
  chatUiReducer,
  createInitialChatUiState,
  MAX_TOOL_CARDS_PER_MESSAGE,
} from './chat-reducer';
import { MAX_SUBAGENT_CHILDREN } from './record-budget';

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

  it('evicts the oldest completed children once the parent map exceeds the cap', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-1' });
    state = chatUiReducer(state, {
      type: 'subagent/children-hydrate',
      parentSessionId: 'parent-1',
      children: Array.from({ length: MAX_SUBAGENT_CHILDREN + 6 }, (_, index) => ({
        ...childSummary(`child-${index}`, 'parent-1'),
        subagentStatus: 'done' as const,
      })),
    });
    expect(Object.keys(state.subagentChildren)).toHaveLength(MAX_SUBAGENT_CHILDREN);
    expect(state.subagentChildren['child-0']).toBeUndefined();
    expect(state.subagentChildren[`child-${MAX_SUBAGENT_CHILDREN + 5}`]?.id).toBe(
      `child-${MAX_SUBAGENT_CHILDREN + 5}`,
    );
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

    state = chatUiReducer(state, {
      type: 'subagent/batch-updated',
      parentSessionId: 'parent-1',
      runId: 'run-1',
      result: { runId: 'run-1', status: 'running', results: [] },
    });
    state = chatUiReducer(state, {
      type: 'subagent/task-updated',
      parentSessionId: 'parent-1',
      runId: 'run-1',
      result: {
        runId: 'run-1',
        taskId: 't1',
        executionStatus: 'running',
        summaryStatus: 'pending',
        integrationStatus: 'pending',
      },
    });
    expect(Object.keys(state.subagentBatches)).toHaveLength(1);
    expect(Object.keys(state.subagentTaskResults)).toHaveLength(1);

    state = chatUiReducer(state, { type: 'session/set', sessionId: 'parent-2' });
    expect(Object.keys(state.subagentChildren)).toHaveLength(0);
    expect(Object.keys(state.subagentStreams)).toHaveLength(0);
    expect(Object.keys(state.subagentInvocations)).toHaveLength(0);
    expect(Object.keys(state.subagentBatches)).toHaveLength(0);
    expect(Object.keys(state.subagentTaskResults)).toHaveLength(0);
  });

  it('uses clientMessageId for optimistic user bubbles and rolls them back', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'user/send',
      text: 'hello',
      clientMessageId: 'client-user-1',
    });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]?.id).toBe('client-user-1');
    expect(state.streaming).toBe(true);
    expect(state.runPhase).toBe('streaming');
    expect(state.activeRunId).toBeNull();
    expect(state.workingSessionIds).toEqual({ s1: true });

    state = chatUiReducer(state, {
      type: 'user/send-rollback',
      clientMessageId: 'client-user-1',
    });
    expect(state.messages).toHaveLength(0);
    expect(state.streaming).toBe(false);
    expect(state.runPhase).toBe('idle');
    expect(state.workingSessionIds).toEqual({});
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
      instructionId: 'intervention-1',
      targetRunId: 'run-1',
    });

    expect(state.messages.at(-1)).toMatchObject({
      id: 'steer-client-1',
      role: 'user',
      text: 'Use the smaller fix',
      instructionDelivery: { status: 'pending', instructionId: 'intervention-1' },
    });
    expect(state.activeRunId).toBe('run-1');
    expect(state.runPhase).toBe('streaming');
    expect(state.streaming).toBe(true);
  });

  it('projects intervention revisions onto the optimistic user row', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'user/steer',
      text: 'initial direction',
      clientMessageId: 'intervention-user-1',
    });
    state = chatUiReducer(state, {
      type: 'run/intervention-updated',
      intervention: {
        interventionId: 'intervention-1',
        revision: 2,
        sessionId: 's1',
        runId: 'run-1',
        runtimeGenerationId: 'generation-1',
        sequence: 1,
        userMessageId: 'intervention-user-1',
        status: 'pending',
        input: { text: 'revised direction' },
        submittedAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:01.000Z',
      },
    });

    expect(state.messages.at(-1)).toMatchObject({
      text: 'revised direction',
      runId: 'run-1',
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: 'intervention-1',
        status: 'pending',
        revision: 2,
      },
    });
  });

  it('ignores a stale intervention projection after a newer revision', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, {
      type: 'user/steer',
      text: 'initial direction',
      clientMessageId: 'intervention-user-1',
      instructionId: 'intervention-1',
      targetRunId: 'run-1',
    });
    const base = {
      interventionId: 'intervention-1',
      sessionId: 's1',
      runId: 'run-1',
      runtimeGenerationId: 'generation-1',
      sequence: 1,
      userMessageId: 'intervention-user-1',
      submittedAt: '2026-08-15T00:00:00.000Z',
    } as const;
    state = chatUiReducer(state, {
      type: 'run/intervention-updated',
      intervention: {
        ...base,
        revision: 3,
        status: 'applied',
        input: { text: 'new direction' },
        updatedAt: '2026-08-15T00:00:02.000Z',
      },
    });
    const afterApplied = state;
    state = chatUiReducer(state, {
      type: 'run/intervention-updated',
      intervention: {
        ...base,
        revision: 2,
        status: 'pending',
        input: { text: 'stale direction' },
        updatedAt: '2026-08-15T00:00:01.000Z',
      },
    });

    expect(state).toBe(afterApplied);
    expect(state.messages.at(-1)).toMatchObject({
      text: 'new direction',
      instructionDelivery: { status: 'applied', revision: 3 },
    });
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

  it('keeps transcript ownership on the old session while awaiting transcript', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-a' });
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'session-a',
      messages: [
        {
          id: 'a-1',
          role: 'user',
          text: 'from A',
          createdAt: '2026-08-12T00:00:00.000Z',
          status: 'done',
        },
      ],
    });
    expect(state.transcriptOwnerSessionId).toBe('session-a');

    // Cold switch to B: old rows stay painted, owner must remain A.
    state = chatUiReducer(state, {
      type: 'session/set',
      sessionId: 'session-b',
      awaitTranscript: true,
    });
    expect(state.activeSessionId).toBe('session-b');
    expect(state.awaitingTranscript).toBe(true);
    expect(state.messages.map((message) => message.id)).toEqual(['a-1']);
    expect(state.transcriptOwnerSessionId).toBe('session-a');

    // B's transcript commits: owner flips to B.
    state = chatUiReducer(state, {
      type: 'session/load-messages',
      sessionId: 'session-b',
      messages: [
        {
          id: 'b-1',
          role: 'user',
          text: 'from B',
          createdAt: '2026-08-12T00:01:00.000Z',
          status: 'done',
        },
      ],
    });
    expect(state.awaitingTranscript).toBe(false);
    expect(state.transcriptOwnerSessionId).toBe('session-b');
  });

  it('clears transcript ownership on every path that clears the active session', () => {
    // A stale owner on an empty transcript makes the duplicate/fork/retry
    // guards in use-session-actions reject sidebar actions with a misleading
    // "still loading" error until some session is opened.
    const stateWithOwner = () => {
      let state = createInitialChatUiState();
      state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-a' });
      state = chatUiReducer(state, {
        type: 'session/load-messages',
        sessionId: 'session-a',
        messages: [
          {
            id: 'a-1',
            role: 'user',
            text: 'from A',
            createdAt: '2026-08-12T00:00:00.000Z',
            status: 'done',
          },
        ],
      });
      expect(state.transcriptOwnerSessionId).toBe('session-a');
      return state;
    };

    const afterScopeSwitch = chatUiReducer(stateWithOwner(), {
      type: 'scope/set',
      scope: { kind: 'project', projectPath: '/p' },
    });
    expect(afterScopeSwitch.activeSessionId).toBe('session-a');
    expect(afterScopeSwitch.transcriptOwnerSessionId).toBeNull();

    const afterProjectSet = chatUiReducer(stateWithOwner(), {
      type: 'project/set',
      path: '/p',
      trusted: true,
    });
    expect(afterProjectSet.activeSessionId).toBe('session-a');
    expect(afterProjectSet.transcriptOwnerSessionId).toBeNull();

    let projectState = chatUiReducer(stateWithOwner(), {
      type: 'scope/set',
      scope: { kind: 'project', projectPath: '/p' },
    });
    projectState = chatUiReducer(projectState, { type: 'session/set', sessionId: 'session-p' });
    projectState = chatUiReducer(projectState, {
      type: 'session/load-messages',
      sessionId: 'session-p',
      messages: [
        {
          id: 'p-1',
          role: 'user',
          text: 'from P',
          createdAt: '2026-08-12T00:02:00.000Z',
          status: 'done',
        },
      ],
    });
    expect(projectState.transcriptOwnerSessionId).toBe('session-p');
    const afterProjectClear = chatUiReducer(projectState, { type: 'project/clear' });
    expect(afterProjectClear.activeSessionId).toBe('session-p');
    expect(afterProjectClear.transcriptOwnerSessionId).toBeNull();

    const afterActiveRemoved = chatUiReducer(stateWithOwner(), {
      type: 'session/remove',
      sessionId: 'session-a',
    });
    expect(afterActiveRemoved.activeSessionId).toBeNull();
    expect(afterActiveRemoved.transcriptOwnerSessionId).toBeNull();

    // Removing a *different* session must keep the painted transcript's owner.
    const afterOtherRemoved = chatUiReducer(stateWithOwner(), {
      type: 'session/remove',
      sessionId: 'session-other',
    });
    expect(afterOtherRemoved.activeSessionId).toBe('session-a');
    expect(afterOtherRemoved.transcriptOwnerSessionId).toBe('session-a');
  });

  it('keeps active session metadata across sidebar paging', () => {
    let state = createInitialChatUiState();
    const namedA = {
      id: 'session-a',
      name: 'Named session A',
      scope: { kind: 'project', projectPath: '/p' } as const,
    };
    state = chatUiReducer(state, {
      type: 'session/hydrate-project',
      projectPath: '/p',
      sessions: [namedA],
    });
    state = chatUiReducer(state, { type: 'session/set', sessionId: 'session-a' });
    expect(state.activeSessionMetadata).toMatchObject({ id: 'session-a', name: 'Named session A' });

    // A later hydrate may omit the active row; metadata must stay selected.
    state = chatUiReducer(state, {
      type: 'session/hydrate-scope',
      scope: { kind: 'project', projectPath: '/p' },
      sessions: [{ id: 'session-zzz', name: 'Other' }],
      totalCount: 80,
      truncated: true,
      fillActiveList: true,
    });
    expect(state.sessions.some((item) => item.id === 'session-a')).toBe(false);
    expect(state.activeSessionMetadata).toMatchObject({ id: 'session-a', name: 'Named session A' });
  });
});

describe('tool card retention cap', () => {
  it('drops tool/start events beyond MAX_TOOL_CARDS_PER_MESSAGE', () => {
    let state = createInitialChatUiState();
    state = chatUiReducer(state, { type: 'session/set', sessionId: 's1' });
    state = chatUiReducer(state, { type: 'run/accepted', runId: 'run-1' });
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: { type: 'message/start', messageId: 'assistant-1', role: 'assistant', runId: 'run-1' },
    });

    for (let index = 0; index < MAX_TOOL_CARDS_PER_MESSAGE + 10; index += 1) {
      state = chatUiReducer(state, {
        type: 'event',
        sessionId: 's1',
        event: {
          type: 'tool/start',
          toolCallId: `tool-${index}`,
          toolName: 'probe',
          runId: 'run-1',
        },
      });
    }

    expect(state.messages[0]?.tools).toHaveLength(MAX_TOOL_CARDS_PER_MESSAGE);
    // tool/end for a dropped card is a no-op, not a crash.
    state = chatUiReducer(state, {
      type: 'event',
      sessionId: 's1',
      event: {
        type: 'tool/end',
        toolCallId: `tool-${MAX_TOOL_CARDS_PER_MESSAGE + 9}`,
        isError: false,
        runId: 'run-1',
      },
    });
    expect(state.messages[0]?.tools).toHaveLength(MAX_TOOL_CARDS_PER_MESSAGE);
  });
});
