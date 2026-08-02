import { describe, expect, it } from 'vitest';
import {
  initSchedulerState,
  nextReadyBatch,
  markTaskRunning,
  markTaskSettled,
  cancelAll,
  isBatchSettled,
  deriveBatchStatus,
} from './subagent-scheduler.js';
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
