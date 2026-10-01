import { describe, expect, it } from 'vitest';
import { createSessionRecord, type SubagentRunManifest } from '@piwin/session';
import type { SubagentTaskResult } from '@piwin/contracts';
import { HOST_INTERRUPTED_FAILURE } from './persisted-error-redaction.js';
import {
  buildPersistedSubagentRepair,
  isPersistedSubagentStateCurrent,
  selectPersistedSubagentChild,
  subagentSessionStatusForResult,
  terminalizePersistedInvocation,
} from './subagent-reconciliation.js';

function child(id: string, task: string, taskId?: string) {
  return createSessionRecord({
    id,
    projectPath: '/repo',
    scope: { kind: 'project', projectPath: '/repo' },
    name: id,
    parentSessionId: 'parent',
    kind: 'subagent',
    task,
    ...(taskId ? { subagentTaskId: taskId } : {}),
    subagentStatus: 'running',
  });
}

function manifest(status: SubagentRunManifest['status']): SubagentRunManifest {
  return {
    runId: 'run-1',
    parentSessionId: 'parent',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    tasks: [{ id: 'task-1', task: 'Review the code' }],
    maxConcurrency: 4,
    failurePolicy: 'continue',
    snapshots: {},
    leases: {},
    results: {},
    invocations: {},
    status,
  };
}

describe('persisted subagent reconciliation', () => {
  it('matches one legacy child by parent task text and interrupts it after restart', () => {
    const run = manifest('running');
    const record = child('child-1', 'Review the code');
    const selected = selectPersistedSubagentChild(run.tasks[0]!, undefined, [record], new Set());
    const repair = buildPersistedSubagentRepair(run, run.tasks[0]!, undefined, selected!);

    expect(repair).toEqual({
      recordResult: true,
      result: {
        runId: 'run-1',
        taskId: 'task-1',
        childSessionId: 'child-1',
        executionStatus: 'failed',
        summaryStatus: 'not-requested',
        integrationStatus: 'not-requested',
        error: 'interrupted by host restart',
        failure: HOST_INTERRUPTED_FAILURE,
      },
    });
  });

  it('does not guess when multiple legacy children have the same task text', () => {
    const run = manifest('running');
    expect(
      selectPersistedSubagentChild(
        run.tasks[0]!,
        undefined,
        [child('child-1', 'Review the code'), child('child-2', 'Review the code')],
        new Set(),
      ),
    ).toBeUndefined();
  });

  it('backfills a missing child id on an existing terminal result', () => {
    const run = manifest('completed');
    const record = child('child-1', 'Review the code', 'task-1');
    const storedResult: SubagentTaskResult = {
      runId: 'run-1',
      taskId: 'task-1',
      executionStatus: 'completed',
      summaryStatus: 'merged',
      integrationStatus: 'not-requested',
    };
    const selected = selectPersistedSubagentChild(
      run.tasks[0]!,
      storedResult,
      [record],
      new Set(),
    );

    expect(buildPersistedSubagentRepair(run, run.tasks[0]!, storedResult, selected!)).toEqual({
      recordResult: false,
      result: { ...storedResult, childSessionId: 'child-1' },
    });
  });

  it('terminalizes the durable invocation while repairing an interrupted child', () => {
    const updated = terminalizePersistedInvocation(
      {
        id: 'invocation-1',
        parentSessionId: 'parent',
        runId: 'run-1',
        taskId: 'task-1',
        task: 'Review the code',
        status: 'running',
        activity: { kind: 'tool', toolName: 'shell' },
        revision: 3,
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:01.000Z',
      },
      {
        runId: 'run-1',
        taskId: 'task-1',
        childSessionId: 'child-1',
        executionStatus: 'failed',
        summaryStatus: 'not-requested',
        integrationStatus: 'not-requested',
        error: 'interrupted by host restart',
      },
      '2026-08-12T00:01:00.000Z',
    );
    expect(updated).toMatchObject({
      childSessionId: 'child-1',
      status: 'failed',
      activity: { kind: 'failed', message: 'interrupted by host restart' },
      revision: 4,
    });
  });
});

describe('startup repair idempotence', () => {
  const result: SubagentTaskResult = {
    runId: 'run-1',
    taskId: 'task-1',
    childSessionId: 'child-1',
    executionStatus: 'completed',
    summaryStatus: 'not-requested',
    integrationStatus: 'retained',
  };
  const invocation = {
    id: 'invocation-1',
    parentSessionId: 'parent',
    runId: 'run-1',
    taskId: 'task-1',
    task: 'Review the code',
    status: 'needs-integration' as const,
    activity: { kind: 'needs-integration' as const },
    childSessionId: 'child-1',
    revision: 5,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:01.000Z',
  };
  const settledChild = {
    subagentStatus: 'done' as const,
    subagentLifecycle: {
      executionStatus: 'completed' as const,
      summaryStatus: 'not-requested' as const,
      integrationStatus: 'retained' as const,
    },
  };
  const repair = { recordResult: false, result };

  it('has nothing to repair when child, invocation and result already agree', () => {
    expect(
      isPersistedSubagentStateCurrent({ repair, storedResult: result, child: settledChild, invocation }),
    ).toBe(true);
    expect(
      isPersistedSubagentStateCurrent({ repair, storedResult: result, child: settledChild, invocation: undefined }),
    ).toBe(true);
  });

  it('repairs an interrupted task, which writes a new result', () => {
    expect(
      isPersistedSubagentStateCurrent({
        repair: { recordResult: true, result },
        storedResult: undefined,
        child: settledChild,
        invocation,
      }),
    ).toBe(false);
  });

  it('repairs each kind of drift between the three records', () => {
    const current = { repair, storedResult: result, child: settledChild, invocation };
    const { childSessionId: _unlinked, ...storedWithoutChild } = result;
    expect(isPersistedSubagentStateCurrent({ ...current, storedResult: storedWithoutChild })).toBe(false);
    expect(isPersistedSubagentStateCurrent({ ...current, child: { ...settledChild, subagentStatus: 'running' } })).toBe(false);
    expect(
      isPersistedSubagentStateCurrent({
        ...current,
        child: {
          ...settledChild,
          subagentLifecycle: { ...settledChild.subagentLifecycle, integrationStatus: 'applied' },
        },
      }),
    ).toBe(false);
    expect(isPersistedSubagentStateCurrent({ ...current, child: { subagentStatus: 'done' } })).toBe(false);
    expect(
      isPersistedSubagentStateCurrent({ ...current, invocation: { ...invocation, status: 'running' } }),
    ).toBe(false);
    expect(
      isPersistedSubagentStateCurrent({ ...current, invocation: { ...invocation, activity: { kind: 'completed' } } }),
    ).toBe(false);
  });

  it('is a fixed point: what a repair writes is current on the next launch', () => {
    const repaired = terminalizePersistedInvocation(invocation, result, '2026-10-01T00:00:00.000Z');
    expect(
      isPersistedSubagentStateCurrent({
        repair,
        storedResult: result,
        child: settledChild,
        invocation: { ...repaired, status: 'running', activity: { kind: 'queued' } },
      }),
    ).toBe(false);
    expect(
      isPersistedSubagentStateCurrent({ repair, storedResult: result, child: settledChild, invocation: repaired }),
    ).toBe(true);
  });

  it('maps a result to the child session status the Desktop shows', () => {
    expect(subagentSessionStatusForResult({ executionStatus: 'completed' })).toBe('done');
    expect(subagentSessionStatusForResult({ executionStatus: 'cancelled' })).toBe('cancelled');
    expect(subagentSessionStatusForResult({ executionStatus: 'running' })).toBe('running');
    expect(subagentSessionStatusForResult({ executionStatus: 'failed' })).toBe('failed');
  });
});
