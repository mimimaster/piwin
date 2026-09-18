import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExecutionRunRecord, HostPush, HostResponse } from '@piwin/contracts';
import { openSessionTranscriptStore, type SessionTranscriptStore } from '@piwin/session';
import { QueuedTurnController } from './queued-turn-controller.js';

async function createStore(sessionId: string): Promise<SessionTranscriptStore> {
  const root = await mkdtemp(join(tmpdir(), 'piwin-queued-controller-'));
  return openSessionTranscriptStore({
    dbPath: join(root, 'transcript.sqlite3'),
    sessionId,
    projectPath: '/tmp/project',
  });
}

function run(runId: string, status: ExecutionRunRecord['status'] = 'running'): ExecutionRunRecord {
  return {
    runId,
    revision: 1,
    kind: 'session-turn',
    status,
    rootRunId: runId,
    sessionId: 'session-1',
  };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('QueuedTurnController', () => {
  it('waits for the exact old Run terminal before admitting one queued turn', async () => {
    const store = await createStore('session-1');
    const pushes: HostPush[] = [];
    let active: ExecutionRunRecord | undefined = run('run-old');
    const runs = new Map<string, ExecutionRunRecord>([['run-old', active]]);
    const admitted: string[] = [];
    const controller = new QueuedTurnController({
      getTranscriptStore: async () => store,
      hasSession: async () => true,
      getForegroundRun: () => active,
      getRun: (runId) => runs.get(runId),
      requestCancelRun: () => undefined,
      updateRunPhase: () => undefined,
      settlePendingPermissions: () => undefined,
      settlePendingExtensionUi: () => undefined,
      validatePromptAttachments: () => undefined,
      admitPrompt: async (command): Promise<HostResponse> => {
        admitted.push(command.input.text);
        active = run('run-new');
        runs.set('run-new', active);
        return {
          type: 'response',
          command: 'session/prompt',
          success: true,
          data: { sessionId: command.sessionId, runId: 'run-new', acceptedAt: new Date().toISOString() },
        };
      },
      push: (message) => pushes.push(message),
    });

    const accepted = await controller.handleCommand(
      {
        type: 'session/queued-turn-submit',
        sessionId: 'session-1',
        queuedTurnId: 'queued-1',
        userMessageId: 'user-1',
        input: { text: 'next task' },
      },
      'request-1',
    );
    expect(accepted).toMatchObject({ success: true, data: { queuedTurn: { status: 'pending' } } });
    await flush();
    expect(admitted).toEqual([]);

    active = undefined;
    runs.set('run-old', run('run-old', 'cancelled'));
    controller.notifyRunTerminal(run('run-old', 'cancelled'));
    await flush();
    await flush();
    expect(admitted).toEqual(['next task']);
    const state = await store.listQueuedTurns();
    expect(state.queuedTurns[0]).toMatchObject({ status: 'started', startedRunId: 'run-new' });
    expect(pushes.findIndex((push) => push.type === 'run/terminal')).toBe(-1);
    expect(pushes.filter((push) => push.type === 'session/queued-turn-updated').map((push) => push.queuedTurn.status)).toEqual([
      'pending',
      'starting',
      'started',
    ]);
    store.close();
  });

  it('rejects Replace Run when the command targets a different foreground Run', async () => {
    const store = await createStore('session-1');
    const controller = new QueuedTurnController({
      getTranscriptStore: async () => store,
      hasSession: async () => true,
      getForegroundRun: () => run('run-current'),
      getRun: () => run('run-current'),
      requestCancelRun: () => run('run-current', 'cancelling'),
      updateRunPhase: () => undefined,
      settlePendingPermissions: () => undefined,
      settlePendingExtensionUi: () => undefined,
      validatePromptAttachments: () => undefined,
      admitPrompt: async (): Promise<HostResponse> => ({
        type: 'response',
        command: 'session/prompt',
        success: false,
        error: 'should not be called',
      }),
      push: () => undefined,
    });
    const response = await controller.handleCommand(
      {
        type: 'session/replace-run',
        sessionId: 'session-1',
        runId: 'run-stale',
        queuedTurnId: 'queued-replace',
        userMessageId: 'user-replace',
        input: { text: 'replace' },
      },
      'request-2',
    );
    expect(response).toMatchObject({ success: false, error: 'queued-turn-run-mismatch' });
    store.close();
  });

  it('replays an accepted Replace Run after the target has started cancelling', async () => {
    const store = await createStore('session-1');
    let active: ExecutionRunRecord | undefined = run('run-old');
    const runs = new Map<string, ExecutionRunRecord>([['run-old', active]]);
    const pushes: HostPush[] = [];
    const controller = new QueuedTurnController({
      getTranscriptStore: async () => store,
      hasSession: async () => true,
      getForegroundRun: () => active,
      getRun: (runId) => runs.get(runId),
      requestCancelRun: (_sessionId, runId) => {
        if (active?.runId !== runId) return undefined;
        active = { ...active, status: 'cancelling' };
        runs.set(runId, active);
        return active;
      },
      updateRunPhase: () => undefined,
      settlePendingPermissions: () => undefined,
      settlePendingExtensionUi: () => undefined,
      validatePromptAttachments: () => undefined,
      admitPrompt: async (command): Promise<HostResponse> => {
        active = run('run-new');
        runs.set('run-new', active);
        return {
          type: 'response',
          command: 'session/prompt',
          success: true,
          data: { sessionId: command.sessionId, runId: 'run-new', acceptedAt: new Date().toISOString() },
        };
      },
      push: (message) => pushes.push(message),
    });
    const command = {
      type: 'session/replace-run' as const,
      sessionId: 'session-1',
      runId: 'run-old',
      queuedTurnId: 'queued-replace-retry',
      userMessageId: 'user-replace-retry',
      input: { text: 'replace once' },
    };
    const first = await controller.handleCommand(command, 'replace-first');
    expect(first).toMatchObject({ success: true, data: { queuedTurn: { status: 'pending' } } });
    const retry = await controller.handleCommand(command, 'replace-retry');
    expect(retry).toMatchObject({ success: true, data: { queuedTurn: { status: 'pending' } } });
    expect(
      pushes.filter(
        (push) =>
          push.type === 'transcript/append' && push.message.id === 'user-replace-retry',
      ),
    ).toHaveLength(1);

    active = undefined;
    runs.set('run-old', run('run-old', 'cancelled'));
    controller.notifyRunTerminal(run('run-old', 'cancelled'));
    await flush();
    await flush();
    expect(await store.listQueuedTurns()).toMatchObject({
      queuedTurns: [expect.objectContaining({ status: 'started', startedRunId: 'run-new' })],
    });
    store.close();
  });

  it('retries admission when the parent run is already terminal', async () => {
    const store = await createStore('session-1');
    const pushes: HostPush[] = [];
    let attempts = 0;
    const controller = new QueuedTurnController({
      getTranscriptStore: async () => store,
      hasSession: async () => true,
      getForegroundRun: () => undefined,
      getRun: () => undefined,
      requestCancelRun: () => undefined,
      updateRunPhase: () => undefined,
      settlePendingPermissions: () => undefined,
      settlePendingExtensionUi: () => undefined,
      validatePromptAttachments: () => undefined,
      admitPrompt: async (command): Promise<HostResponse> => {
        attempts += 1;
        if (attempts === 1) {
          return {
            type: 'response',
            command: 'session/prompt',
            success: false,
            error: 'parent run is already terminal: run-old',
          };
        }
        return {
          type: 'response',
          command: 'session/prompt',
          success: true,
          data: {
            sessionId: command.sessionId,
            runId: 'run-new',
            acceptedAt: new Date().toISOString(),
          },
        };
      },
      push: (message) => pushes.push(message),
    });

    const accepted = await controller.handleCommand(
      {
        type: 'session/queued-turn-submit',
        sessionId: 'session-1',
        queuedTurnId: 'queued-retry',
        userMessageId: 'user-retry',
        input: { text: 'next after terminal parent' },
      },
      'request-retry',
    );
    expect(accepted).toMatchObject({ success: true });
    await flush();
    await flush();
    expect(attempts).toBe(2);
    expect(await store.listQueuedTurns()).toMatchObject({
      queuedTurns: [expect.objectContaining({ status: 'started', startedRunId: 'run-new' })],
    });
    expect(
      pushes.some(
        (push) =>
          push.type === 'host/log' &&
          push.message.includes('parent run is already terminal'),
      ),
    ).toBe(true);
    store.close();
  });
});
