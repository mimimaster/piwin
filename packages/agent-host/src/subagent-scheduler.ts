/**
 * CE-SUB-ORCH: pure dependency scheduler for parallel subagent execution.
 *
 * This module performs no I/O, process, filesystem, or Git operations. It
 * consumes `SubagentTaskSpec` and configured concurrency limits, and
 * produces deterministic ready batches. The orchestrator calls
 * `nextReadyBatch` after each task settles to get the next group of
 * task ids that can run concurrently.
 */

import type { SubagentBatchRequest, SubagentTaskSpec } from '@piwin/contracts';

/** Task status tracked by the scheduler. */
export type SchedulerTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Internal scheduler state (mutable; the orchestrator drives it). */
export type SchedulerState = {
  /** Map of task id → current status. */
  status: Map<string, SchedulerTaskStatus>;
  /** Map of task id → set of unsatisfied dependency ids. */
  remainingDeps: Map<string, Set<string>>;
  /** Tasks by id. */
  tasks: Map<string, SubagentTaskSpec>;
  /** Configured concurrency limit. */
  maxConcurrency: number;
  /** Failure policy. */
  failurePolicy: 'continue' | 'fail-fast';
  /** Whether the batch has been cancelled. */
  cancelled: boolean;
};

/**
 * Initialize scheduler state from a batch request. Assumes the request has
 * already been validated by `validateSubagentBatchRequest`.
 */
export function initSchedulerState(request: SubagentBatchRequest): SchedulerState {
  const status = new Map<string, SchedulerTaskStatus>();
  const remainingDeps = new Map<string, Set<string>>();
  const tasks = new Map<string, SubagentTaskSpec>();
  for (const task of request.tasks) {
    status.set(task.id, 'pending');
    remainingDeps.set(task.id, new Set(task.dependsOn ?? []));
    tasks.set(task.id, task);
  }
  return {
    status,
    remainingDeps,
    tasks,
    maxConcurrency: request.maxConcurrency ?? 4,
    failurePolicy: request.failurePolicy ?? 'continue',
    cancelled: false,
  };
}

/**
 * Compute the next batch of task ids that are ready to run (all dependencies
 * completed, status is pending, and concurrency budget allows). Returns an
 * empty array when no tasks can start. The orchestrator marks each id as
 * 'running' before dispatching.
 */
export function nextReadyBatch(state: SchedulerState): string[] {
  if (state.cancelled) return [];

  const ready: string[] = [];
  let runningCount = 0;
  for (const status of state.status.values()) {
    if (status === 'running') runningCount++;
  }

  const budget = state.maxConcurrency - runningCount;
  if (budget <= 0) return [];

  for (const [taskId, deps] of state.remainingDeps) {
    if (ready.length >= budget) break;
    if (state.status.get(taskId) !== 'pending') continue;
    // All deps must be completed (not failed/cancelled — those are handled
    // by markTaskSettled which cancels dependents).
    let satisfied = true;
    for (const dep of deps) {
      if (state.status.get(dep) !== 'completed') {
        satisfied = false;
        break;
      }
    }
    if (satisfied) ready.push(taskId);
  }

  return ready;
}

/**
 * Mark a task as running. The orchestrator calls this before dispatching.
 */
export function markTaskRunning(state: SchedulerState, taskId: string): void {
  state.status.set(taskId, 'running');
}

/**
 * Mark a task as settled (completed, failed, or cancelled). When a task
 * fails or is cancelled, its dependents are cancelled (transitively) unless
 * the failure policy is 'continue' — in which case dependents of a *failed*
 * task are still cancelled because their input is missing, but the batch
 * continues with other independent tasks.
 *
 * Returns the list of task ids that were cancelled as a side effect.
 */
export function markTaskSettled(
  state: SchedulerState,
  taskId: string,
  outcome: 'completed' | 'failed' | 'cancelled',
): string[] {
  state.status.set(taskId, outcome);
  if (outcome === 'completed') {
    // Remove this task from remaining deps of dependents.
    for (const [_, deps] of state.remainingDeps) {
      deps.delete(taskId);
    }
    return [];
  }

  // Failed or cancelled: cancel all transitive dependents.
  const cancelled: string[] = [];
  const queue = [taskId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [candidateId, deps] of state.remainingDeps) {
      if (deps.has(current) && state.status.get(candidateId) === 'pending') {
        state.status.set(candidateId, 'cancelled');
        cancelled.push(candidateId);
        queue.push(candidateId);
      }
    }
  }
  return cancelled;
}

/**
 * Mark the entire batch as cancelled. All pending and running tasks become
 * cancelled. The orchestrator calls this when the user requests cancellation
 * or when fail-fast triggers.
 */
export function cancelAll(state: SchedulerState): void {
  state.cancelled = true;
  for (const [taskId, status] of state.status) {
    if (status === 'pending' || status === 'running') {
      state.status.set(taskId, 'cancelled');
    }
  }
}

/**
 * Returns true when all tasks have reached a terminal state (completed,
 * failed, or cancelled). The orchestrator uses this to decide when to
 * emit the batch result.
 */
export function isBatchSettled(state: SchedulerState): boolean {
  for (const status of state.status.values()) {
    if (status === 'pending' || status === 'running') return false;
  }
  return true;
}

/**
 * Derive the batch-level status from the scheduler state. The batch is:
 * - 'completed' when all tasks completed
 * - 'failed' when any task failed (and none were cancelled)
 * - 'cancelled' when any task was cancelled
 * - 'needs-integration' is set by the orchestrator when integration
 *   conflicts are detected (not derivable from scheduler state alone)
 */
export function deriveBatchStatus(state: SchedulerState): 'completed' | 'failed' | 'cancelled' {
  let hasFailed = false;
  let hasCancelled = false;
  for (const status of state.status.values()) {
    if (status === 'failed') hasFailed = true;
    if (status === 'cancelled') hasCancelled = true;
  }
  if (hasCancelled) return 'cancelled';
  if (hasFailed) return 'failed';
  return 'completed';
}
