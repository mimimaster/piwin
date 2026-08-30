import type { SubagentBatchResult, SubagentTaskResult } from '@piwin/contracts';
import { deriveBatchStatus } from './subagent-scheduler.js';
import {
  combineErrors,
  toError,
  type BatchState,
  type SubagentOrchestratorContext,
} from './subagent-orchestrator-batch.js';
import { recordTaskResult } from './subagent-orchestrator-invocation.js';

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
    const fallback: SubagentTaskResult = {
      runId: batchState.runId,
      taskId: task.id,
      executionStatus: forcedStatus === 'failed' ? 'failed' : 'cancelled',
      summaryStatus: 'not-requested',
      integrationStatus: 'not-requested',
      ...(forcedStatus === 'failed' && fatalError ? { error: fatalError.message } : {}),
      ...(task.role ? { role: task.role } : {}),
      ...(task.profileId ? { profileId: task.profileId } : {}),
      ...(task.model ? { model: task.model } : {}),
      ...(task.allowedOutputPaths !== undefined
        ? { allowedOutputPaths: [...task.allowedOutputPaths] }
        : {}),
    };
    batchState.results.set(task.id, fallback);
    await recordTaskResult(deps, batchState, fallback);
  }
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
