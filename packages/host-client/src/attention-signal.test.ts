import { describe, expect, it } from 'vitest';
import type { ExecutionRunRecord, HostPush } from '@piwin/contracts';
import { readAttentionSignals } from './attention-signal.js';

const ENDED_AT = '2026-09-17T12:00:00.000Z';

function sessionTurn(
  overrides: Partial<ExecutionRunRecord> & Pick<ExecutionRunRecord, 'status'>,
): ExecutionRunRecord {
  return {
    runId: 'run-1',
    kind: 'session-turn',
    rootRunId: 'run-1',
    sessionId: 'session-1',
    endedAt: ENDED_AT,
    ...overrides,
  };
}

function runPush(
  type: 'run/terminal' | 'run/updated',
  run: ExecutionRunRecord,
): HostPush {
  return { type, run };
}

describe('readAttentionSignals', () => {
  it('T01 session-turn completed → turn-complete with run key and endedAt', () => {
    expect(readAttentionSignals(runPush('run/terminal', sessionTurn({ status: 'completed' })))).toEqual([
      {
        type: 'raise',
        kind: 'turn-complete',
        key: 'run:run-1',
        sessionId: 'session-1',
        source: 'run',
        runId: 'run-1',
        endedAt: ENDED_AT,
      },
      { type: 'settle-questions', sessionId: 'session-1' },
    ]);
  });

  it('T02 session-turn failed → turn-failed', () => {
    const signals = readAttentionSignals(
      runPush('run/terminal', sessionTurn({ status: 'failed', terminalCode: 'failed' })),
    );
    expect(signals[0]).toMatchObject({
      type: 'raise',
      kind: 'turn-failed',
      key: 'run:run-1',
      source: 'run',
      endedAt: ENDED_AT,
    });
    expect(signals[1]).toEqual({ type: 'settle-questions', sessionId: 'session-1' });
  });

  it('T03 cancelled + user-stop or missing terminalCode → only settle-questions', () => {
    expect(
      readAttentionSignals(
        runPush('run/terminal', sessionTurn({ status: 'cancelled', terminalCode: 'user-stop' })),
      ),
    ).toEqual([{ type: 'settle-questions', sessionId: 'session-1' }]);
    expect(readAttentionSignals(runPush('run/terminal', sessionTurn({ status: 'cancelled' })))).toEqual([
      { type: 'settle-questions', sessionId: 'session-1' },
    ]);
  });

  it('T04 cancelled + tool-loop-stalled → turn-failed', () => {
    const signals = readAttentionSignals(
      runPush(
        'run/terminal',
        sessionTurn({ status: 'cancelled', terminalCode: 'tool-loop-stalled' }),
      ),
    );
    expect(signals[0]).toMatchObject({
      type: 'raise',
      kind: 'turn-failed',
      key: 'run:run-1',
    });
    expect(signals).toHaveLength(2);
  });

  it('T05 interrupted + paused → silent; + worker-crash → turn-failed', () => {
    expect(
      readAttentionSignals(
        runPush('run/terminal', sessionTurn({ status: 'interrupted', terminalCode: 'paused' })),
      ),
    ).toEqual([{ type: 'settle-questions', sessionId: 'session-1' }]);
    const crashed = readAttentionSignals(
      runPush(
        'run/terminal',
        sessionTurn({ status: 'interrupted', terminalCode: 'worker-crash' }),
      ),
    );
    expect(crashed[0]).toMatchObject({ type: 'raise', kind: 'turn-failed', key: 'run:run-1' });
    expect(crashed[1]).toEqual({ type: 'settle-questions', sessionId: 'session-1' });
  });

  it('T06 subagent-task completed → no raise', () => {
    expect(
      readAttentionSignals(
        runPush(
          'run/terminal',
          sessionTurn({ kind: 'subagent-task', status: 'completed', taskId: 'task-1' }),
        ),
      ),
    ).toEqual([]);
  });

  it('T07 terminal run/updated and run/terminal produce the same key', () => {
    const run = sessionTurn({ status: 'completed' });
    const fromUpdated = readAttentionSignals(runPush('run/updated', run));
    const fromTerminal = readAttentionSignals(runPush('run/terminal', run));
    expect(fromUpdated).toEqual(fromTerminal);
    expect(fromUpdated[0]).toMatchObject({ key: 'run:run-1' });
  });

  it('T08 running run/updated → empty array', () => {
    expect(
      readAttentionSignals(runPush('run/updated', sessionTurn({ status: 'running' }))),
    ).toEqual([]);
  });

  it('T09 permission/request action bash keeps permissionAction; slash or space omits it', () => {
    const bash = readAttentionSignals({
      type: 'permission/request',
      sessionId: 'session-1',
      requestId: 'perm-1',
      action: 'bash',
      detail: 'ls',
      defaultDecision: 'ask',
    });
    expect(bash).toEqual([
      {
        type: 'raise',
        kind: 'needs-input',
        key: 'permission:perm-1',
        sessionId: 'session-1',
        source: 'permission',
        permissionAction: 'bash',
      },
    ]);

    const slash = readAttentionSignals({
      type: 'permission/request',
      sessionId: 'session-1',
      requestId: 'perm-2',
      action: 'git/commit',
      detail: 'git commit',
      defaultDecision: 'ask',
    });
    expect(slash[0]).toMatchObject({
      type: 'raise',
      key: 'permission:perm-2',
      source: 'permission',
    });
    expect(slash[0]).not.toHaveProperty('permissionAction');

    const spaced = readAttentionSignals({
      type: 'permission/request',
      sessionId: 'session-1',
      requestId: 'perm-3',
      action: 'bash -lc',
      detail: 'echo hi',
      defaultDecision: 'ask',
    });
    expect(spaced[0]).not.toHaveProperty('permissionAction');
  });

  it('T10 serialized signals omit permission detail and context values', () => {
    const detail = 'SECRET_PERM_DETAIL_TOKEN';
    const contextSummary = 'SECRET_PERM_CONTEXT_SUMMARY';
    const command = 'SECRET_PERM_COMMAND';
    const signals = readAttentionSignals({
      type: 'permission/request',
      sessionId: 'session-1',
      requestId: 'perm-secret',
      action: 'bash',
      detail,
      defaultDecision: 'ask',
      context: {
        kind: 'command',
        summary: contextSummary,
        command,
        cwd: '/secret/workdir',
      },
    });
    const json = JSON.stringify(signals);
    expect(json).not.toContain(detail);
    expect(json).not.toContain(contextSummary);
    expect(json).not.toContain(command);
    expect(json).not.toContain('/secret/workdir');
    expect(json).not.toContain('"detail"');
    expect(json).not.toContain('"context"');
  });

  it('T11 permission/resolved settles the same key; extension/ui_request raises question', () => {
    expect(
      readAttentionSignals({
        type: 'permission/resolved',
        sessionId: 'session-1',
        requestId: 'perm-1',
        decision: 'allow',
      }),
    ).toEqual([
      {
        type: 'settle',
        sessionId: 'session-1',
        key: 'permission:perm-1',
      },
    ]);
    expect(
      readAttentionSignals({
        type: 'extension/ui_request',
        sessionId: 'session-1',
        requestId: 'q-1',
        kind: 'confirm',
        title: 'Continue?',
      }),
    ).toEqual([
      {
        type: 'raise',
        kind: 'needs-input',
        key: 'question:q-1',
        sessionId: 'session-1',
        source: 'question',
      },
    ]);
  });
});
