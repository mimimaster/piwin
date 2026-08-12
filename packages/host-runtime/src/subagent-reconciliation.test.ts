import { describe, expect, it } from 'vitest';
import { createSessionRecord, type SubagentRunManifest } from '@piwin/session';
import type { SubagentTaskResult } from '@piwin/contracts';
import { HOST_INTERRUPTED_FAILURE } from './persisted-error-redaction.js';
import {
  buildPersistedSubagentRepair,
  selectPersistedSubagentChild,
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
