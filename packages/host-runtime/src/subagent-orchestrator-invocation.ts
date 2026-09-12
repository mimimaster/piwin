import {
  pickSubagentLineageRefs,
  type SubagentInvocation,
  type SubagentInvocationActivity,
  type SubagentInvocationStatus,
  type SubagentTaskResult,
  type SubagentTaskSpec,
} from '@piwin/contracts';
import {
  invocationActivityForResult,
  invocationStatusForResult,
} from './subagent-invocation-state.js';
import {
  invocationActivityKey,
  toError,
  type BatchState,
  type SubagentOrchestratorContext,
} from './subagent-orchestrator-batch.js';

export async function recordTaskResult(
  deps: SubagentOrchestratorContext,
  batchState: BatchState,
  result: SubagentTaskResult,
): Promise<void> {
  try {
    await deps.runStore?.recordResult(batchState.runId, result.taskId, result);
  } catch (error) {
    batchState.errors.push(toError(error));
  }
  const task = batchState.schedulerState.tasks.get(result.taskId);
  if (task) {
    await updateInvocation(deps, batchState, task, {
      status: invocationStatusForResult(result),
      activity: invocationActivityForResult(result),
      ...(result.childSessionId ? { childSessionId: result.childSessionId } : {}),
    });
  }
  try {
    await deps.onTaskResult?.({
      parentSessionId: batchState.request.parentSessionId,
      result,
    });
  } catch (error) {
    batchState.errors.push(toError(error));
  }
}

export async function updateInvocation(
  deps: SubagentOrchestratorContext,
  batchState: BatchState,
  task: SubagentTaskSpec,
  update: {
    status: SubagentInvocationStatus;
    activity: SubagentInvocationActivity;
    childSessionId?: string;
  },
): Promise<void> {
  const invocationId = task.invocationId;
  if (!invocationId) return;
  const current = batchState.invocations.get(invocationId);
  if (
    current &&
    current.status === update.status &&
    invocationActivityKey(current.activity) === invocationActivityKey(update.activity) &&
    (update.childSessionId === undefined || current.childSessionId === update.childSessionId)
  ) {
    return;
  }
  const now = new Date().toISOString();
  const invocation: SubagentInvocation = {
    id: invocationId,
    parentSessionId: task.parentSessionId,
    runId: batchState.runId,
    ...(task.parentRunId ? { parentRunId: task.parentRunId } : {}),
    ...(task.parentToolCallId ? { parentToolCallId: task.parentToolCallId } : {}),
    taskId: task.id,
    task: task.task,
    ...(task.sessionName ? { title: task.sessionName } : {}),
    ...(task.role ? { role: task.role } : {}),
    ...(task.profileId ? { profileId: task.profileId } : {}),
    ...(task.model ? { model: task.model } : {}),
    ...(task.isolationOverride ? { isolation: task.isolationOverride } : {}),
    ...pickSubagentLineageRefs({
      ...(current ?? {}),
      ...pickSubagentLineageRefs(task),
    }),
    ...(update.childSessionId
      ? { childSessionId: update.childSessionId }
      : current?.childSessionId
        ? { childSessionId: current.childSessionId }
        : {}),
    status: update.status,
    activity: update.activity,
    revision: (current?.revision ?? 0) + 1,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  batchState.invocations.set(invocationId, invocation);
  try {
    await deps.runStore?.recordInvocation?.(batchState.runId, invocation);
  } catch (error) {
    batchState.errors.push(toError(error));
  }
  deps.emitPush(batchState, {
    type: 'subagent/invocation-updated',
    parentSessionId: task.parentSessionId,
    invocation,
  });
}
