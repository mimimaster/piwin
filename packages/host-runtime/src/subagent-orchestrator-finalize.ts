import type { SubagentBatchResult, SubagentTaskResult } from '@piwin/contracts';
import { deriveBatchStatus } from './subagent-scheduler.js';
import {
  combineErrors,
  toError,
  type BatchState,
  type SubagentOrchestratorContext,
} from './subagent-orchestrator-batch.js';
import { recordTaskResult } from './subagent-orchestrator-invocation.js';

/**
 * Reason stamped on tasks the user stopped, so the parent model does not
 * treat the cancellation as a transient failure and re-dispatch the task.
 */
export const USER_STOPPED_SUBAGENT_MESSAGE =
  'Stopped by the user. Do not restart this task unless the user asks for it.';

function cancelledFallbackResult(
  batchState: BatchState,
  task: BatchState['request']['tasks'][number],
  forcedStatus: 'failed' | undefined,
  error: string | undefined,
): SubagentTaskResult {
  return {
    runId: batchState.runId,
    taskId: task.id,
    executionStatus: forcedStatus === 'failed' ? 'failed' : 'cancelled',
    summaryStatus: 'not-requested',
    integrationStatus: 'not-requested',
    ...(error ? { error } : {}),
    ...(task.role ? { role: task.role } : {}),
    ...(task.profileId ? { profileId: task.profileId } : {}),
    ...(task.model ? { model: task.model } : {}),
    ...(task.allowedOutputPaths !== undefined
      ? { allowedOutputPaths: [...task.allowedOutputPaths] }
      : {}),
  };
}

/** Attach the user-stop reason to cancelled results that carry no error yet. */
async function stampUserStop(
  deps: SubagentOrchestratorContext,
  batchState: BatchState,
): Promise<void> {
  if (batchState.cancelledByUser !== true) return;
  for (const [taskId, result] of batchState.results) {
    if (result.executionStatus !== 'cancelled' || result.error) continue;
    const stamped = { ...result, error: USER_STOPPED_SUBAGENT_MESSAGE };
    batchState.results.set(taskId, stamped);
    try {
      await deps.runStore?.recordResult(batchState.runId, taskId, stamped);
    } catch (error) {
      batchState.errors.push(toError(error));
    }
  }
}

/**
 * Settle waiters for a cancelled batch whose runners never unwound. The run
 * tree and invocations become cancelled now; if a runner unwinds later,
 * finalizeBatch still records its real outcome.
 */
export async function detachCancelledBatch(
  deps: SubagentOrchestratorContext,
  batchState: BatchState,
  message: string,
): Promise<SubagentBatchResult> {
  const reason = batchState.cancelledByUser === true ? USER_STOPPED_SUBAGENT_MESSAGE : message;
  for (const task of batchState.request.tasks) {
    if (batchState.results.has(task.id)) continue;
    const fallback = cancelledFallbackResult(batchState, task, undefined, reason);
    batchState.results.set(task.id, fallback);
    await recordTaskResult(deps, batchState, fallback);
  }
  await stampUserStop(deps, batchState);
  deps.runRegistry.forceTerminateDescendants(batchState.runId, message);
  deps.runRegistry.terminate(batchState.runId, 'cancelled', 'cancelled', message);
  const result: SubagentBatchResult = {
    runId: batchState.runId,
    status: 'cancelled',
    results: batchState.request.tasks.flatMap((task) => {
      const taskResult = batchState.results.get(task.id);
      return taskResult ? [taskResult] : [];
    }),
  };
  deps.emitPush(batchState, {
    type: 'subagent/batch-updated',
    runId: batchState.runId,
    parentSessionId: batchState.request.parentSessionId,
    result,
  });
  batchState.resolveCompletion(result);
  return result;
}

export async function releaseWorkspaceLeases(
  deps: SubagentOrchestratorContext,
  batchState: BatchState,
): Promise<void> {
  const releaseResults = await Promise.allSettled(
    [...batchState.leases.values()].map((lease) => deps.workspaceService.release(lease)),
  );
  const releaseErrors = releaseResults.flatMap((result) =>
    result.status === 'rejected' ? [toError(result.reason)] : [],
  );
  if (releaseErrors.length > 0) {
    throw combineErrors(releaseErrors, 'one or more subagent workspace leases failed to release');
  }
}

export async function finalizeBatch(
  deps: SubagentOrchestratorContext,
  batchState: BatchState,
  forcedStatus: 'failed' | undefined,
  fatalError: Error | undefined,
): Promise<SubagentBatchResult> {
  for (const task of batchState.request.tasks) {
    if (batchState.results.has(task.id)) continue;
    const fallback = cancelledFallbackResult(
      batchState,
      task,
      forcedStatus,
      forcedStatus === 'failed' ? fatalError?.message : undefined,
    );
    batchState.results.set(task.id, fallback);
    await recordTaskResult(deps, batchState, fallback);
  }
  await stampUserStop(deps, batchState);
  const hasIntegrationConflict = [...batchState.results.values()].some(
    (result) => result.integrationStatus === 'conflict',
  );
  const hasIntegrationFailure = [...batchState.results.values()].some(
    (result) => result.integrationStatus === 'failed',
  );
  const hasExplicitIntegrationPending = batchState.request.tasks.some(
    (task) =>
      task.applyPolicy === 'explicit' &&
      batchState.results.get(task.id)?.integrationStatus === 'retained',
  );

  let batchStatus: 'completed' | 'failed' | 'cancelled' | 'needs-integration' =
    forcedStatus ?? deriveBatchStatus(batchState.schedulerState);
  if (batchStatus !== 'cancelled' && (hasIntegrationConflict || hasExplicitIntegrationPending)) {
    batchStatus = 'needs-integration';
  }
  if (batchStatus === 'completed' && (hasIntegrationFailure || fatalError)) {
    batchStatus = 'failed';
  }

  try {
    await deps.runStore?.setStatus(batchState.runId, batchStatus);
  } catch (error) {
    batchState.errors.push(toError(error));
    batchStatus = 'failed';
    try {
      await deps.runStore?.setStatus(batchState.runId, 'failed');
    } catch (retryError) {
      batchState.errors.push(toError(retryError));
    }
  }

  const terminalStatus =
    batchStatus === 'completed'
      ? 'completed'
      : batchStatus === 'cancelled'
        ? 'cancelled'
        : 'failed';
  const terminalCode =
    batchStatus === 'needs-integration'
      ? 'integration-required'
      : batchStatus === 'failed'
        ? 'failed'
        : batchStatus === 'cancelled'
          ? 'cancelled'
          : 'completed';
  deps.runRegistry.terminate(batchState.runId, terminalStatus, terminalCode);

  const result: SubagentBatchResult = {
    runId: batchState.runId,
    status: batchStatus,
    results: batchState.request.tasks.flatMap((task) => {
      const taskResult = batchState.results.get(task.id);
      return taskResult ? [taskResult] : [];
    }),
  };

  deps.emitPush(batchState, {
    type: 'subagent/batch-updated',
    runId: batchState.runId,
    parentSessionId: batchState.request.parentSessionId,
    result,
  });
  deps.activeBatches.delete(batchState.runId);
  return result;
}
