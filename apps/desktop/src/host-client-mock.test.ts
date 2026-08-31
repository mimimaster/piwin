import { describe, expect, it } from 'vitest';
import type {
  HostPush,
  SessionListData,
  SessionListPageData,
  SessionTranscriptMessage,
  UsageRollup,
} from '@piwin/contracts';
import { MockHostBackend } from './host-client-mock';

describe('MockHostBackend usage', () => {
  it('provides model + Key cache rows for browser-mode visual testing', async () => {
    const backend = new MockHostBackend(
      () => {},
      () => 'sdk',
    );
    const response = await backend.handle(
      { type: 'usage/get-rollup', projectPath: '/tmp/mock-project' },
      'usage',
    );

    expect(response.success).toBe(true);
    if (!response.success) throw new Error(response.error);
    const rollup = (response.data as { rollup: UsageRollup }).rollup;
    expect(rollup.scope).toEqual({ kind: 'project', projectPath: '/tmp/mock-project' });
    expect(rollup.byModelKey).toHaveLength(3);
    expect(rollup.byModelKey[0]).toMatchObject({
      providerId: 'openai-work',
      modelId: 'gpt-5.2-codex',
    });
  });
});

describe('MockHostBackend session/list', () => {
  it('sorts globally, truncates after sort, and returns Host metadata', async () => {
    const backend = new MockHostBackend(
      () => {},
      () => 'sdk',
    );
    const names = ['Zulu', 'Alpha', 'Bravo'] as const;
    const sessionIds: string[] = [];
    for (const name of names) {
      const created = await backend.handle(
        {
          type: 'session/create',
          input: { scope: { kind: 'general' }, sessionName: name },
        },
        `create-list-${name}`,
      );
      if (!created.success) throw new Error(created.error);
      sessionIds.push((created.data as { sessionId: string }).sessionId);
    }
    const zuluId = sessionIds[0];
    if (zuluId === undefined) throw new Error('missing zulu fixture');
    const pin = await backend.handle({ type: 'session/pin', sessionId: zuluId }, 'pin-zulu');
    if (!pin.success) throw new Error(pin.error);

    const alphabetical = await backend.handle(
      {
        type: 'session/list',
        scope: { kind: 'general' },
        order: 'alphabetical',
        maxItems: 2,
      },
      'list-alpha',
    );
    if (!alphabetical.success) throw new Error(alphabetical.error);
    const alphaData = alphabetical.data as SessionListData;
    expect(alphaData.sessions.map((session) => session.name)).toEqual(['Alpha', 'Bravo']);
    expect(alphaData.totalCount).toBe(3);
    expect(alphaData.truncated).toBe(true);

    const updated = await backend.handle(
      {
        type: 'session/list',
        scope: { kind: 'general' },
        order: 'updated',
        maxItems: 2,
      },
      'list-updated',
    );
    if (!updated.success) throw new Error(updated.error);
    const updatedData = updated.data as SessionListData;
    expect(updatedData.sessions[0]?.name).toBe('Zulu');
    expect(updatedData.sessions).toHaveLength(2);
    expect(updatedData.totalCount).toBe(3);
    expect(updatedData.truncated).toBe(true);

    const unbounded = await backend.handle(
      { type: 'session/list', scope: { kind: 'general' } },
      'list-unbounded',
    );
    if (!unbounded.success) throw new Error(unbounded.error);
    const unboundedData = unbounded.data as SessionListData;
    expect(unboundedData.sessions).toHaveLength(3);
    expect(unboundedData.totalCount).toBe(3);
    expect(unboundedData.truncated).toBe(false);

    const rejected = await backend.handle(
      { type: 'session/list', scope: { kind: 'general' }, maxItems: 0 },
      'list-invalid',
    );
    expect(rejected.success).toBe(false);
    if (rejected.success) throw new Error('expected mock session/list to reject invalid maxItems');
    expect(rejected.error).toMatch(/maxItems must be a positive safe integer/i);
  });
});

describe('MockHostBackend session pages', () => {
  it('matches the bounded page and stale-cursor contract', async () => {
    const backend = new MockHostBackend(
      () => {},
      () => 'sdk',
    );
    const sessionIds: string[] = [];
    for (let index = 0; index < 14; index += 1) {
      const created = await backend.handle(
        {
          type: 'session/create',
          input: {
            scope: { kind: 'general' },
            sessionName: `Mock Chat ${index.toString().padStart(2, '0')}`,
          },
        },
        `create-page-${index}`,
      );
      if (!created.success) throw new Error(created.error);
      sessionIds.push((created.data as { sessionId: string }).sessionId);
    }

    const firstResponse = await backend.handle(
      {
        type: 'session/list-page',
        query: {
          scope: { kind: 'general' },
          lifecycle: 'active',
          order: 'alphabetical',
          limit: 6,
        },
      },
      'first-page',
    );
    if (!firstResponse.success) throw new Error(firstResponse.error);
    const first = firstResponse.data as SessionListPageData;
    expect(first.status).toBe('page');
    if (first.status !== 'page') return;
    expect(first.sessions).toHaveLength(6);
    expect(first.page.totalCount).toBe(14);
    const nextCursor = first.page.nextCursor;
    if (nextCursor === undefined) throw new Error('expected next cursor');
    const anchorSessionId = sessionIds[13];
    if (anchorSessionId === undefined) throw new Error('missing anchor session fixture');

    const anchoredResponse = await backend.handle(
      {
        type: 'session/list-page',
        query: {
          scope: { kind: 'general' },
          lifecycle: 'active',
          order: 'alphabetical',
          limit: 6,
          anchorSessionId,
        },
      },
      'anchored-page',
    );
    if (!anchoredResponse.success) throw new Error(anchoredResponse.error);
    const anchored = anchoredResponse.data as SessionListPageData;
    expect(anchored.status).toBe('page');
    if (anchored.status !== 'page') return;
    expect(anchored.page.pageIndex).toBe(2);
    expect(anchored.sessions.some((session) => session.id === anchorSessionId)).toBe(true);

    const firstSessionId = sessionIds[0];
    if (firstSessionId === undefined) throw new Error('missing session fixture');
    await backend.handle(
      { type: 'session/rename', sessionId: firstSessionId, name: 'AAA Mock Chat' },
      'rename-page',
    );
    const staleResponse = await backend.handle(
      {
        type: 'session/list-page',
        query: {
          scope: { kind: 'general' },
          lifecycle: 'active',
          order: 'alphabetical',
          limit: 6,
          cursor: nextCursor,
        },
      },
      'stale-page',
    );
    if (!staleResponse.success) throw new Error(staleResponse.error);
    expect((staleResponse.data as SessionListPageData).status).toBe('stale-cursor');
  });
});

describe('MockHostBackend run lifecycle', () => {
  it('keeps stale aborts from cancelling the active run and emits one terminal event', async () => {
    const pushes: HostPush[] = [];
    const backend = new MockHostBackend(
      (message) => {
        pushes.push(message);
      },
      () => 'sdk',
    );
    const createResponse = await backend.handle(
      { type: 'session/create', input: { projectPath: '/tmp/mock' } },
      'create',
    );
    expect(createResponse.success).toBe(true);
    if (!createResponse.success) return;
    const sessionId = (createResponse.data as { sessionId: string }).sessionId;

    const promptResponse = await backend.handle(
      { type: 'session/prompt', sessionId, input: { text: '__PIWIN_RENDER_STRESS__' } },
      'prompt',
    );
    expect(promptResponse.success).toBe(true);
    if (!promptResponse.success) return;
    const runId = (promptResponse.data as { runId: string }).runId;

    await waitForPush(
      pushes,
      (push) => push.type === 'run/updated' && push.run.phase === 'streaming',
    );
    const staleAbort = await backend.handle(
      { type: 'session/abort', sessionId, runId: 'stale-run' },
      'stale-abort',
    );
    expect(staleAbort).toMatchObject({
      success: true,
      data: { cancelled: false, reason: 'run-mismatch', activeRunId: runId },
    });
    expect(pushes.some((push) => push.type === 'run/terminal')).toBe(false);

    const abortResponse = await backend.handle(
      { type: 'session/abort', sessionId, runId },
      'abort',
    );
    expect(abortResponse).toMatchObject({ success: true, data: { cancelled: true, runId } });
    await waitForPush(pushes, (push) => push.type === 'run/terminal');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const terminalEvents = pushes.filter(
      (push) => push.type === 'run/terminal' && push.run.runId === runId,
    );
    expect(terminalEvents).toHaveLength(1);
    const terminalEvent = terminalEvents[0];
    expect(terminalEvent?.type).toBe('run/terminal');
    if (terminalEvent?.type === 'run/terminal') {
      expect(terminalEvent.run).toMatchObject({ status: 'cancelled', terminalCode: 'cancelled' });
    }
  });
});

describe('MockHostBackend queued turns', () => {
  it('persists a next-turn request and drains it only after the foreground terminal push', async () => {
    const pushes: HostPush[] = [];
    const backend = new MockHostBackend(
      (message) => pushes.push(message),
      () => 'sdk',
    );
    const created = await backend.handle(
      { type: 'session/create', input: { projectPath: '/tmp/mock-queue' } },
      'queue-create',
    );
    expect(created.success).toBe(true);
    if (!created.success) return;
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const prompt = await backend.handle(
      { type: 'session/prompt', sessionId, input: { text: '__PIWIN_RENDER_STRESS__' } },
      'queue-prompt',
    );
    expect(prompt.success).toBe(true);
    if (!prompt.success) return;
    const activeRunId = (prompt.data as { runId: string }).runId;
    await waitForPush(
      pushes,
      (push) => push.type === 'run/updated' && push.run.runId === activeRunId && push.run.phase === 'streaming',
    );

    const queued = await backend.handle(
      {
        type: 'session/queued-turn-submit',
        sessionId,
        queuedTurnId: 'queued-next',
        userMessageId: 'queued-user',
        input: { text: 'next task' },
      },
      'queue-submit',
    );
    expect(queued).toMatchObject({ success: true, data: { queuedTurn: { status: 'pending' } } });
    expect(
      pushes.some(
        (push) =>
          push.type === 'session/queued-turn-updated' &&
          push.queuedTurn.queuedTurnId === 'queued-next' &&
          push.queuedTurn.status === 'pending',
      ),
    ).toBe(true);

    const aborted = await backend.handle(
      { type: 'session/abort', sessionId, runId: activeRunId },
      'queue-abort',
    );
    expect(aborted).toMatchObject({ success: true, data: { cancelled: true } });
    await waitForPush(
      pushes,
      (push) => push.type === 'session/queued-turn-updated' && push.queuedTurn.status === 'started',
    );
    const queue = await backend.handle(
      { type: 'session/queued-turn-list', sessionId },
      'queue-list',
    );
    expect(queue).toMatchObject({
      success: true,
      data: { queuedTurns: [expect.objectContaining({ status: 'started', startedRunId: expect.any(String) })] },
    });
    const transcript = await backend.handle(
      { type: 'session/messages', sessionId },
      'queue-messages',
    );
    expect(transcript).toMatchObject({
      success: true,
      data: {
        messages: expect.arrayContaining([
          expect.objectContaining({
            id: 'queued-user',
            instructionDelivery: expect.objectContaining({ kind: 'queued-turn', status: 'started' }),
          }),
        ]),
      },
    });
  });
});

describe('MockHostBackend product session lineage', () => {
  it('exposes fork origins through session/lineage', async () => {
    const pushes: HostPush[] = [];
    const backend = new MockHostBackend(
      (message) => {
        pushes.push(message);
      },
      () => 'sdk',
    );
    const createResponse = await backend.handle(
      { type: 'session/create', input: { projectPath: '/tmp/mock' } },
      'create-lineage',
    );
    expect(createResponse.success).toBe(true);
    if (!createResponse.success) return;
    const sourceSessionId = (createResponse.data as { sessionId: string }).sessionId;

    const promptResponse = await backend.handle(
      { type: 'session/prompt', sessionId: sourceSessionId, input: { text: 'hello lineage' } },
      'prompt-lineage',
    );
    expect(promptResponse.success).toBe(true);
    if (!promptResponse.success) return;
    const runId = (promptResponse.data as { runId: string }).runId;
    await waitForPush(pushes, (push) => push.type === 'run/terminal' && push.run.runId === runId);

    const messagesResponse = await backend.handle(
      { type: 'session/messages', sessionId: sourceSessionId },
      'messages-lineage',
    );
    expect(messagesResponse.success).toBe(true);
    if (!messagesResponse.success) return;
    const messages = (messagesResponse.data as { messages: SessionTranscriptMessage[] }).messages;
    const assistantMessage = messages.find(
      (message) => message.role === 'assistant' && message.status === 'done',
    );
    expect(assistantMessage).toBeDefined();
    if (!assistantMessage) return;

    const forkResponse = await backend.handle(
      {
        type: 'session/fork',
        sessionId: sourceSessionId,
        messageId: assistantMessage.id,
        workspaceStrategy: 'shared',
      },
      'fork-lineage',
    );
    expect(forkResponse.success).toBe(true);
    if (!forkResponse.success) return;
    const forkSessionId = (forkResponse.data as { sessionId: string }).sessionId;

    const lineageResponse = await backend.handle(
      { type: 'session/lineage', sessionId: forkSessionId },
      'lineage',
    );
    expect(lineageResponse).toMatchObject({ success: true, command: 'session/lineage' });
    if (!lineageResponse.success) return;
    const lineage = lineageResponse.data as {
      rootSessionId: string;
      activeSessionId: string;
      nodes: Array<{ sessionId: string; origin?: { kind: string; sourceSessionId?: string } }>;
    };
    expect(lineage.rootSessionId).toBe(sourceSessionId);
    expect(lineage.activeSessionId).toBe(forkSessionId);
    expect(lineage.nodes.map((node) => node.sessionId)).toEqual(
      expect.arrayContaining([sourceSessionId, forkSessionId]),
    );
    expect(lineage.nodes.find((node) => node.sessionId === forkSessionId)?.origin).toMatchObject({
      kind: 'fork',
      sourceSessionId,
    });
  });
});

describe('MockHostBackend assembly summary', () => {
  it('emits a user-bound assembly capsule and returns it on read-back', async () => {
    const pushes: HostPush[] = [];
    const backend = new MockHostBackend(
      (message) => {
        pushes.push(message);
      },
      () => 'sdk',
    );
    const createResponse = await backend.handle(
      { type: 'session/create', input: { projectPath: '/tmp/mock' } },
      'create-assembly',
    );
    expect(createResponse.success).toBe(true);
    if (!createResponse.success) return;
    const sessionId = (createResponse.data as { sessionId: string }).sessionId;
    const promptResponse = await backend.handle(
      {
        type: 'session/prompt',
        sessionId,
        input: { text: 'show assembly', clientMessageId: 'user-assembly-1' },
      },
      'prompt-assembly',
    );
    expect(promptResponse.success).toBe(true);
    const summary = pushes.find((push) => push.type === 'agent/context-summary');
    expect(summary?.type).toBe('agent/context-summary');
    if (summary?.type !== 'agent/context-summary') return;
    expect(summary.userMessageId).toBe('user-assembly-1');
    expect(summary.coverage).toBe('assembly-only');
    expect(JSON.stringify(summary)).not.toContain('/Users/');
    const readBack = await backend.handle(
      { type: 'session/model-context-summary', sessionId },
      'read-assembly',
    );
    expect(readBack.success).toBe(true);
    if (!readBack.success) return;
    expect(readBack.data).toMatchObject({
      sessionId,
      coverage: 'assembly-only',
      summaries: [expect.objectContaining({ userMessageId: 'user-assembly-1' })],
    });

    const duplicated = await backend.handle(
      { type: 'session/duplicate', sessionId },
      'dup-assembly',
    );
    expect(duplicated.success).toBe(true);
    if (!duplicated.success) return;
    const duplicateSessionId = (duplicated.data as { sessionId: string }).sessionId;
    const duplicateRead = await backend.handle(
      { type: 'session/model-context-summary', sessionId: duplicateSessionId },
      'read-dup-assembly',
    );
    expect(duplicateRead.success).toBe(true);
    if (!duplicateRead.success) return;
    const duplicateSummaries = (
      duplicateRead.data as {
        summaries: Array<{ sessionId: string; userMessageId?: string }>;
      }
    ).summaries;
    expect(duplicateSummaries).toHaveLength(1);
    expect(duplicateSummaries[0]?.sessionId).toBe(duplicateSessionId);
    expect(duplicateSummaries[0]?.userMessageId).not.toBe('user-assembly-1');
  });
});

describe('MockHostBackend pause checkpoint', () => {
  async function createPausedSession(): Promise<{
    backend: MockHostBackend;
    sessionId: string;
    runId: string;
    pushes: HostPush[];
  }> {
    const pushes: HostPush[] = [];
    const backend = new MockHostBackend(
      (message) => {
        pushes.push(message);
      },
      () => 'sdk',
    );
    const created = await backend.handle(
      { type: 'session/create', input: { projectPath: '/tmp/mock-pause' } },
      'create',
    );
    if (!created.success) throw new Error(created.error);
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const prompt = await backend.handle(
      {
        type: 'session/prompt',
        sessionId,
        input: { text: 'Please produce a fairly long reply so I can pause mid way.' },
      },
      'prompt',
    );
    if (!prompt.success) throw new Error(prompt.error);
    const runId = (prompt.data as { runId: string }).runId;
    await waitForPush(
      pushes,
      (push) =>
        push.type === 'run/updated' &&
        push.run.runId === runId &&
        push.run.phase === 'waiting-first-token',
    );
    const pause = await backend.handle(
      { type: 'session/pause', sessionId, runId },
      'pause',
    );
    if (!pause.success) throw new Error(pause.error);
    await waitForPush(
      pushes,
      (push): push is Extract<HostPush, { type: 'run/terminal' }> =>
        push.type === 'run/terminal' &&
        push.run.runId === runId &&
        push.run.terminalCode === 'paused',
    );
    return { backend, sessionId, runId, pushes };
  }

  it('abort after pause keeps the checkpoint so resume-run can continue', async () => {
    const { backend, sessionId } = await createPausedSession();
    const abort = await backend.handle({ type: 'session/abort', sessionId }, 'abort');
    expect(abort).toMatchObject({ success: true, data: { cancelled: false } });
    const resume = await backend.handle({ type: 'session/resume-run', sessionId }, 'resume');
    expect(resume.success).toBe(true);
  });

  it('a new prompt retires the checkpoint and records the user message', async () => {
    const { backend, sessionId, runId, pushes } = await createPausedSession();
    const next = await backend.handle(
      {
        type: 'session/prompt',
        sessionId,
        input: { text: '先别继续，解释刚才的错误', clientMessageId: 'new-after-pause' },
      },
      'next-prompt',
    );
    expect(next.success).toBe(true);
    if (!next.success) throw new Error(next.error);
    const nextRunId = (next.data as { runId: string }).runId;
    expect(nextRunId).not.toBe(runId);
    await waitForPush(
      pushes,
      (push) => push.type === 'run/terminal' && push.run.runId === nextRunId,
    );

    const messages = await backend.handle({ type: 'session/messages', sessionId }, 'messages');
    if (!messages.success) throw new Error(messages.error);
    const transcript = (messages.data as { messages: SessionTranscriptMessage[] }).messages;
    expect(transcript.filter((message) => message.id === 'new-after-pause')).toMatchObject([
      { role: 'user', text: '先别继续，解释刚才的错误' },
    ]);
    expect(
      transcript.some((message) =>
        message.text.includes('Continue the interrupted task from the current transcript'),
      ),
    ).toBe(false);

    const resume = await backend.handle({ type: 'session/resume-run', sessionId }, 'resume');
    expect(resume.success).toBe(false);
    if (resume.success) throw new Error('expected resume-run to fail after a new prompt');
    expect(resume.error).toMatch(/no-active-checkpoint/);
  });
});

async function waitForPush(
  pushes: HostPush[],
  predicate: (push: HostPush) => boolean,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const matchingPush = pushes.find(predicate);
    if (matchingPush) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for mock host event');
}
