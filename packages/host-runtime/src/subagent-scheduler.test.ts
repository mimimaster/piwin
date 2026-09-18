import { describe, expect, it } from 'vitest';
import {
  initSchedulerState,
  nextReadyBatch,
  markTaskRunning,
  markTaskSettled,
  cancelAll,
  isBatchSettled,
  deriveBatchStatus,
  isWriteTask,
} from './subagent-scheduler.js';
import { DEFAULT_SUBAGENT_MAX_CONCURRENCY } from '@piwin/contracts';
import type { SubagentBatchRequest, SubagentTaskSpec } from '@piwin/contracts';

function makeTask(overrides: Partial<SubagentTaskSpec> = {}): SubagentTaskSpec {
  return {
    id: 'task-1',
    parentSessionId: 'parent-1',
    task: 'do something',
    ...overrides,
  };
}

function makeBatch(tasks: SubagentTaskSpec[], overrides: Partial<SubagentBatchRequest> = {}): SubagentBatchRequest {
  return {
    parentSessionId: 'parent-1',
    tasks,
    maxConcurrency: 4,
    ...overrides,
  };
}

describe('initSchedulerState', () => {
  it('defaults maxConcurrency to DEFAULT_SUBAGENT_MAX_CONCURRENCY', () => {
    const state = initSchedulerState({ parentSessionId: 'parent-1', tasks: [makeTask()] });
    expect(state.maxConcurrency).toBe(DEFAULT_SUBAGENT_MAX_CONCURRENCY);
  });

  it('initializes all tasks as pending', () => {
    const state = initSchedulerState(makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]));
    expect(state.status.get('a')).toBe('pending');
    expect(state.status.get('b')).toBe('pending');
    expect(state.maxConcurrency).toBe(4);
    expect(state.cancelled).toBe(false);
  });

  it('tracks remaining dependencies', () => {
    const state = initSchedulerState(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b', dependsOn: ['a'] })]),
    );
    expect(state.remainingDeps.get('a')).toEqual(new Set());
    expect(state.remainingDeps.get('b')).toEqual(new Set(['a']));
  });
});

describe('isWriteTask', () => {
  it('identifies worktree isolation tasks as write tasks', () => {
    expect(isWriteTask(makeTask({ isolationOverride: 'worktree' }))).toBe(true);
    expect(isWriteTask(makeTask({ isolationOverride: 'readonly' }))).toBe(false);
    expect(isWriteTask(makeTask())).toBe(false);
    expect(isWriteTask(undefined)).toBe(false);
  });
});

describe('nextReadyBatch', () => {
  it('returns tasks with no dependencies when budget allows', () => {
    const state = initSchedulerState(makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]));
    const ready = nextReadyBatch(state);
    expect(ready).toEqual(['a', 'b']);
  });

  it('returns only tasks whose dependencies are completed', () => {
    const state = initSchedulerState(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b', dependsOn: ['a'] })]),
    );
    expect(nextReadyBatch(state)).toEqual(['a']);
    markTaskRunning(state, 'a');
    expect(nextReadyBatch(state)).toEqual([]);
    markTaskSettled(state, 'a', 'completed');
    expect(nextReadyBatch(state)).toEqual(['b']);
  });

  it('respects concurrency budget', () => {
    const state = initSchedulerState(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' }), makeTask({ id: 'c' })], {
        maxConcurrency: 2,
      }),
    );
    const ready = nextReadyBatch(state);
    expect(ready).toHaveLength(2);
    markTaskRunning(state, ready[0]!);
    markTaskRunning(state, ready[1]!);
    // Budget exhausted.
    expect(nextReadyBatch(state)).toEqual([]);
  });

  it('allows only one write task ready at a time even with high concurrency budget', () => {
    const state = initSchedulerState(
      makeBatch(
        [
          makeTask({ id: 'w1', isolationOverride: 'worktree' }),
          makeTask({ id: 'w2', isolationOverride: 'worktree' }),
          makeTask({ id: 'r1', isolationOverride: 'readonly' }),
        ],
        { maxConcurrency: 4 },
      ),
    );
    const ready = nextReadyBatch(state);
    // Exactly one write task and the readonly task can be ready concurrently.
    expect(ready).toEqual(['w1', 'r1']);
  });

  it('blocks new write tasks while a write task is currently running, but allows readonly', () => {
    const state = initSchedulerState(
      makeBatch(
        [
          makeTask({ id: 'w1', isolationOverride: 'worktree' }),
          makeTask({ id: 'w2', isolationOverride: 'worktree' }),
          makeTask({ id: 'r1', isolationOverride: 'readonly' }),
        ],
        { maxConcurrency: 4 },
      ),
    );
    // Mark w1 as running
    markTaskRunning(state, 'w1');

    // Next ready batch should include readonly r1, but w2 must wait
    const ready = nextReadyBatch(state);
    expect(ready).toEqual(['r1']);
  });

  it('unblocks pending write task after running write task settles', () => {
    const state = initSchedulerState(
      makeBatch(
        [
          makeTask({ id: 'w1', isolationOverride: 'worktree' }),
          makeTask({ id: 'w2', isolationOverride: 'worktree' }),
        ],
        { maxConcurrency: 4 },
      ),
    );
    expect(nextReadyBatch(state)).toEqual(['w1']);
    markTaskRunning(state, 'w1');
    expect(nextReadyBatch(state)).toEqual([]);

    // Settle w1
    markTaskSettled(state, 'w1', 'completed');
    // Now w2 is ready
    expect(nextReadyBatch(state)).toEqual(['w2']);
  });

  it('returns empty when cancelled', () => {
    const state = initSchedulerState(makeBatch([makeTask({ id: 'a' })]));
    cancelAll(state);
    expect(nextReadyBatch(state)).toEqual([]);
  });

  it('does not return tasks that are already running', () => {
    const state = initSchedulerState(makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]));
    const ready = nextReadyBatch(state);
    markTaskRunning(state, ready[0]!);
    const next = nextReadyBatch(state);
    expect(next).toHaveLength(1);
    expect(next).not.toContain(ready[0]);
  });
});

describe('markTaskSettled', () => {
  it('removes completed task from dependents remaining deps', () => {
    const state = initSchedulerState(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b', dependsOn: ['a'] })]),
    );
    markTaskSettled(state, 'a', 'completed');
    expect(state.remainingDeps.get('b')?.has('a')).toBe(false);
    expect(state.status.get('a')).toBe('completed');
  });

  it('cancels transitive dependents on failure', () => {
    const state = initSchedulerState(
      makeBatch([
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
        makeTask({ id: 'c', dependsOn: ['b'] }),
      ]),
    );
    const cancelled = markTaskSettled(state, 'a', 'failed');
    expect(cancelled).toContain('b');
    expect(cancelled).toContain('c');
    expect(state.status.get('b')).toBe('cancelled');
    expect(state.status.get('c')).toBe('cancelled');
  });

  it('cancels transitive dependents on cancellation', () => {
    const state = initSchedulerState(
      makeBatch([
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
      ]),
    );
    const cancelled = markTaskSettled(state, 'a', 'cancelled');
    expect(cancelled).toEqual(['b']);
    expect(state.status.get('b')).toBe('cancelled');
  });

  it('does not cancel independent tasks on failure', () => {
    const state = initSchedulerState(
      makeBatch([
        makeTask({ id: 'a' }),
        makeTask({ id: 'b' }),
        makeTask({ id: 'c', dependsOn: ['a'] }),
      ]),
    );
    const cancelled = markTaskSettled(state, 'a', 'failed');
    expect(cancelled).toEqual(['c']);
    expect(state.status.get('b')).toBe('pending');
  });
});

describe('cancelAll', () => {
  it('cancels all pending and running tasks', () => {
    const state = initSchedulerState(makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]));
    markTaskRunning(state, 'a');
    cancelAll(state);
    expect(state.status.get('a')).toBe('cancelled');
    expect(state.status.get('b')).toBe('cancelled');
    expect(state.cancelled).toBe(true);
  });

  it('keeps cancelled task states terminal when late completion arrives', () => {
    const state = initSchedulerState(makeBatch([makeTask({ id: 'a' })]));
    markTaskRunning(state, 'a');
    cancelAll(state);

    markTaskSettled(state, 'a', 'completed');

    expect(state.status.get('a')).toBe('cancelled');
  });
});

describe('isBatchSettled', () => {
  it('returns false when tasks are pending or running', () => {
    const state = initSchedulerState(makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]));
    expect(isBatchSettled(state)).toBe(false);
    markTaskRunning(state, 'a');
    expect(isBatchSettled(state)).toBe(false);
  });

  it('returns true when all tasks are terminal', () => {
    const state = initSchedulerState(makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]));
    markTaskSettled(state, 'a', 'completed');
    markTaskSettled(state, 'b', 'completed');
    expect(isBatchSettled(state)).toBe(true);
  });
});

describe('deriveBatchStatus', () => {
  it('returns completed when all tasks completed', () => {
    const state = initSchedulerState(makeBatch([makeTask({ id: 'a' })]));
    markTaskSettled(state, 'a', 'completed');
    expect(deriveBatchStatus(state)).toBe('completed');
  });

  it('returns failed when any task failed (no cancellations)', () => {
    const state = initSchedulerState(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]),
    );
    markTaskSettled(state, 'a', 'completed');
    markTaskSettled(state, 'b', 'failed');
    expect(deriveBatchStatus(state)).toBe('failed');
  });

  it('returns cancelled when tasks were cancelled without any failure', () => {
    const state = initSchedulerState(
      makeBatch([makeTask({ id: 'a' }), makeTask({ id: 'b' })]),
    );
    markTaskSettled(state, 'a', 'completed');
    markTaskSettled(state, 'b', 'cancelled');
    expect(deriveBatchStatus(state)).toBe('cancelled');
  });

  it('returns failed when a task failed even if dependents were cancelled', () => {
    const state = initSchedulerState(
      makeBatch([
        makeTask({ id: 'a' }),
        makeTask({ id: 'b', dependsOn: ['a'] }),
      ]),
    );
    markTaskSettled(state, 'a', 'failed');
    // 'b' is cancelled as a side effect of 'a' failing.
    expect(deriveBatchStatus(state)).toBe('failed');
  });
});
