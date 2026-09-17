import { randomUUID } from 'node:crypto';
import {
  pickSubagentLineageRefs,
  type SubagentTaskResult,
  type SubagentTaskRunInput,
  type SubagentTaskSpec,
  type SubagentWorkspaceLease,
} from '@piwin/contracts';
import type { SubagentIntegrationControl } from './subagent-integration-coordinator.js';
import { createPersistedFailure, redactPersistedMessage } from './persisted-error-redaction.js';
import { markTaskSettled, type SchedulerState } from './subagent-scheduler.js';
import {
  toError,
  type BatchState,
  type SubagentOrchestratorContext,
} from './subagent-orchestrator-batch.js';
import { recordTaskResult, updateInvocation } from './subagent-orchestrator-invocation.js';

function admittedResultFacts(task: SubagentTaskSpec): Partial<SubagentTaskResult> {
  return {
    ...(task.allowedOutputPaths !== undefined
      ? { allowedOutputPaths: [...task.allowedOutputPaths] }
      : {}),
    ...(task.deliveryIntent ? { deliveryIntent: task.deliveryIntent } : {}),
    ...(task.applyPolicy ? { applyPolicy: task.applyPolicy } : {}),
    ...(task.legacyManual !== undefined ? { legacyManual: task.legacyManual } : {}),
    ...(task.candidateGroupId ? { candidateGroupId: task.candidateGroupId } : {}),
    ...(task.resultRef ? { resultRef: task.resultRef } : {}),
    ...pickSubagentLineageRefs(task),
  };
}

/**
 * Freezing is bookkeeping after the child already stopped. Its failure must not
 * rewrite a finished child as an execution failure or skip integration, which
 * reads the worktree through Git on its own. The result just lacks frozen refs.
 */
async function freezeChildResultBestEffort(
  freeze: NonNullable<SubagentOrchestratorContext['freezeChildResult']>,
  result: SubagentTaskResult,
  lease: SubagentWorkspaceLease,
): Promise<SubagentTaskResult> {
  try {
    return await freeze({ result, lease });
  } catch (error) {
    console.warn(
      `[subagent] freeze of task ${result.taskId} failed; continuing without frozen changes: ${redactPersistedMessage(toError(error).message)}`,
    );
    return result;
  }
}

/** Dispatch a single task: acquire resource, workspace, run, settle, integrate. */
export async function dispatchTask(
  deps: SubagentOrchestratorContext,
  runId: string,
  task: SubagentTaskSpec,
  state: SchedulerState,
  batchState: BatchState,
): Promise<void> {
  let lease: SubagentWorkspaceLease | undefined;
  let resourceLease:
    | {
        resourceKind: 'agent-execution';
        runId: string;
        executionClass: 'foreground' | 'subagent';
        acquiredAt: string;
      }
    | undefined;
  let taskRunId: string | undefined;
  let childSessionId: string | undefined;
  const runtimeGenerationId = batchState.runtimeGenerationId;
  let taskSessionRegistered = false;
  let worktreeHandled = false;
  let integrationCommitPointReached = false;

  try {
    await updateInvocation(deps, batchState, task, {
      status: 'starting',
      activity: { kind: 'preparing' },
    });
    // Credential/model preflight deliberately runs before resource,
    // workspace, child-run, and child-session allocation. A missing secret
    // must not leave a durable empty reviewer session behind.
    const preflight = await deps.preflightTask?.({
      parentSessionId: task.parentSessionId,
      task,
    });
    // SC-14: Acquire resource slot if coordinator is available.
    if (deps.resourceCoordinator) {
      const signal = deps.runRegistry.getSignal(runId);
      if (!signal) {
        throw new Error(`batch run signal unavailable: ${runId}`);
      }
      resourceLease = await deps.resourceCoordinator.acquire({
        runId: `${runId}:${task.id}`,
        executionClass: 'subagent',
        signal,
      });
    }

    lease = await deps.workspaceService.acquire(task);
    batchState.leases.set(task.id, lease);
    await deps.runStore?.recordLease?.(runId, task.id, lease);

    // Check for cancellation before creating child run — avoids creating a
    // detached child after parent admission has closed.
    if (!isTaskAdmitted(deps, state, task.id, batchState)) {
      return;
    }

    childSessionId = task.continuationSessionId ?? randomUUID();
    const taskRun = deps.runRegistry.create({
      kind: 'subagent-task',
      sessionId: childSessionId,
      parentRunId: runId,
      taskId: task.id,
      runtimeGenerationId,
    });
    taskRunId = taskRun.runId;
    batchState.taskRunIds.set(task.id, taskRunId);
    deps.runRegistry.start(taskRunId);
    taskSessionRegistered = deps.registerTaskSession !== undefined;
    await deps.registerTaskSession?.({
      childSessionId,
      parentSessionId: task.parentSessionId,
      runtimeGenerationId,
      workingDirectory: lease.cwd,
      task,
      workspaceLease: lease,
    });
    await updateInvocation(deps, batchState, task, {
      status: 'running',
      activity: { kind: 'thinking' },
      childSessionId,
    });

    const prepared = await deps.prepareTask({
      runId,
      taskRunId,
      childSessionId,
      runtimeGenerationId,
      task,
      workspaceLease: lease,
      ...(preflight ? { preflight } : {}),
    });
    await deps.runStore?.recordSnapshot?.(runId, task.id, prepared.runtimeSnapshot);
    await deps.recordTaskPrompt?.({
      childSessionId,
      task,
    });

    const taskInput: SubagentTaskRunInput = {
      taskRunId,
      parentSessionId: task.parentSessionId,
      childSessionId,
      runtimeGenerationId,
      task,
      runtimeSnapshot: prepared.runtimeSnapshot,
      workspaceLease: lease,
      sessionBlueprint: prepared.sessionBlueprint,
      preparedPrompt: prepared.preparedPrompt,
      ...(prepared.seedMessages ? { seedMessages: prepared.seedMessages } : {}),
      providers: prepared.providers,
      ...(prepared.providerSecrets ? { providerSecrets: prepared.providerSecrets } : {}),
    };

    const signal = deps.runRegistry.getSignal(taskRunId);
    if (!signal) {
      throw new Error(`task run signal unavailable: ${taskRunId}`);
    }
    const output = await deps.taskRunner.runTask(taskInput, signal);

    // A runner may ignore abort and return late. Once admission is closed,
    // its result is intentionally discarded and cannot revive the task.
    if (!isTaskAdmitted(deps, state, task.id, batchState)) {
      return;
    }

    let result: SubagentTaskResult = {
      runId,
      taskId: task.id,
      childSessionId: output.childSessionId ?? childSessionId,
      executionStatus: output.executionStatus,
      summaryStatus: output.summaryStatus,
      integrationStatus: output.integrationStatus,
      ...(task.role ? { role: task.role } : {}),
      ...(task.profileId ? { profileId: task.profileId } : {}),
      ...(task.model ? { model: task.model } : {}),
      ...(output.summaryPreview ? { summaryPreview: output.summaryPreview } : {}),
      ...(output.changedFiles ? { changedFiles: output.changedFiles } : {}),
      ...(output.verification ? { verification: output.verification } : {}),
      ...(output.error ? { error: output.error } : {}),
      ...(lease?.worktreePath ? { worktreePath: lease.worktreePath } : {}),
      ...admittedResultFacts(task),
    };

    if (
      result.executionStatus !== 'completed' &&
      lease.mode === 'worktree' &&
      result.integrationStatus === 'not-requested'
    ) {
      await deps.integrationCoordinator.retain(
        lease.worktreePath,
        `task ${task.id} ${result.executionStatus}; worktree retained for inspection`,
      );
      result = { ...result, integrationStatus: 'retained' };
      worktreeHandled = true;
    }

    if (lease?.mode === 'worktree' && deps.freezeChildResult) {
      result = await freezeChildResultBestEffort(deps.freezeChildResult, result, lease);
    }

    if (
      result.executionStatus === 'completed' &&
      lease.mode === 'worktree' &&
      (result.integrationStatus === 'pending' || result.integrationStatus === 'not-requested')
    ) {
      const applyPolicy = task.applyPolicy ?? 'auto';
      const shouldIntegrate =
        applyPolicy === 'auto' &&
        task.deliveryIntent !== 'candidate' &&
        task.deliveryIntent !== 'report';
      if (shouldIntegrate) {
        result = await integrateTask(deps, result, lease, {
          signal,
          onCommitPoint: () => {
            integrationCommitPointReached = true;
          },
          ...(task.retainWorktree === true ? { retainWorktree: true } : {}),
        });
        worktreeHandled = true;
      } else {
        await deps.integrationCoordinator.retain(
          lease.worktreePath,
          applyPolicy === 'explicit'
            ? 'explicit integration policy; awaiting user-selected merge'
            : 'apply policy none; worktree retained by request',
        );
        result = { ...result, integrationStatus: 'retained' };
        worktreeHandled = true;
      }
    }

    if (!isTaskAdmitted(deps, state, task.id, batchState) && !integrationCommitPointReached) {
      return;
    }

    batchState.results.set(task.id, result);
    await recordTaskResult(deps, batchState, result);
    markTaskSettled(
      state,
      task.id,
      result.executionStatus === 'completed'
        ? 'completed'
        : result.executionStatus === 'cancelled'
          ? 'cancelled'
          : 'failed',
    );

    if (taskRunId) {
      const taskStatus =
        result.executionStatus === 'completed'
          ? 'completed'
          : result.executionStatus === 'cancelled'
            ? 'cancelled'
            : 'failed';
      deps.runRegistry.terminate(taskRunId, taskStatus);
    }

    deps.emitPush(batchState, {
      type: 'subagent/task-updated',
      runId,
      parentSessionId: task.parentSessionId,
      result,
    });
  } catch (error) {
    // Cancellation and late backend failures do not replace the cancelled
    // terminal state with a synthetic failure.
    if (!isTaskAdmitted(deps, state, task.id, batchState)) {
      return;
    }

    const message = toError(error).message;
    const failed: SubagentTaskResult = {
      runId,
      taskId: task.id,
      ...(childSessionId ? { childSessionId } : {}),
      executionStatus: 'failed',
      summaryStatus: 'not-requested',
      integrationStatus: 'not-requested',
      ...(task.role ? { role: task.role } : {}),
      ...(task.profileId ? { profileId: task.profileId } : {}),
      ...(task.model ? { model: task.model } : {}),
      error: redactPersistedMessage(message),
      failure: createPersistedFailure(error, {
        kind: 'internal',
        code: 'subagent-task-failed',
        phase: 'execution',
        retryable: false,
      }),
      ...(lease?.worktreePath ? { worktreePath: lease.worktreePath } : {}),
      ...admittedResultFacts(task),
    };
    if (lease?.mode === 'worktree') {
      await deps.integrationCoordinator.retain(
        lease.worktreePath,
        `task ${task.id} failed before integration: ${redactPersistedMessage(message)}`,
      );
      failed.integrationStatus = 'retained';
      worktreeHandled = true;
    }
    batchState.results.set(task.id, failed);
    await recordTaskResult(deps, batchState, failed);
    markTaskSettled(state, task.id, 'failed');

    if (taskRunId) {
      deps.runRegistry.terminate(taskRunId, 'failed', undefined, message);
    }

    deps.emitPush(batchState, {
      type: 'subagent/task-updated',
      runId,
      parentSessionId: task.parentSessionId,
      result: failed,
    });
  } finally {
    // The task owner has now joined, including the late-return path after
    // cancellation. Cancellation only requests abort; this explicit
    // transition is the owner's acknowledgement that its work stopped.
    if (taskRunId && deps.runRegistry.isActive(taskRunId)) {
      deps.runRegistry.terminate(taskRunId, 'cancelled', 'cancelled');
    }
    if (taskSessionRegistered && childSessionId) {
      await deps.unregisterTaskSession?.(childSessionId);
    }
    if (lease?.mode === 'worktree' && !worktreeHandled) {
      await deps.integrationCoordinator.retain(
        lease.worktreePath,
        `task ${task.id} ended before integration; worktree retained for inspection`,
      );
      worktreeHandled = true;
    }
    // A cancelled runner may return after admission has closed, so the
    // normal result path intentionally discards its late output. Persist a
    // cancellation result here so the child session does not remain stuck
    // in the running state and the durable manifest has a complete task.
    if (batchState.schedulerState.cancelled && childSessionId && !batchState.results.has(task.id)) {
      const cancelled: SubagentTaskResult = {
        runId: batchState.runId,
        taskId: task.id,
        childSessionId,
        executionStatus: 'cancelled',
        summaryStatus: 'not-requested',
        integrationStatus: lease?.mode === 'worktree' ? 'retained' : 'not-requested',
        ...(lease?.worktreePath ? { worktreePath: lease.worktreePath } : {}),
        ...admittedResultFacts(task),
      };
      batchState.results.set(task.id, cancelled);
      await recordTaskResult(deps, batchState, cancelled);
      deps.emitPush(batchState, {
        type: 'subagent/task-updated',
        runId: batchState.runId,
        parentSessionId: task.parentSessionId,
        result: cancelled,
      });
    }
    // Release resource lease.
    if (resourceLease && deps.resourceCoordinator) {
      deps.resourceCoordinator.release(resourceLease);
    }
  }
}

function isTaskAdmitted(
  deps: SubagentOrchestratorContext,
  state: SchedulerState,
  taskId: string,
  batchState: BatchState,
): boolean {
  return (
    !state.cancelled &&
    deps.runRegistry.get(batchState.runId)?.status !== 'cancelling' &&
    state.status.get(taskId) === 'running'
  );
}

/** Integrate a completed worktree task's changes. */
async function integrateTask(
  deps: SubagentOrchestratorContext,
  result: SubagentTaskResult,
  lease: SubagentWorkspaceLease,
  control?: SubagentIntegrationControl,
): Promise<SubagentTaskResult> {
  if (lease.mode === 'readonly') return result;

  try {
    const integrated = await deps.integrationCoordinator.integrate(result, lease, control);
    if (
      (integrated.integrationStatus === 'conflict' || integrated.integrationStatus === 'failed') &&
      integrated.failure === undefined
    ) {
      return {
        ...integrated,
        failure: createPersistedFailure(new Error(integrated.error ?? 'integration failed'), {
          kind:
            integrated.integrationStatus === 'conflict'
              ? 'integration-conflict'
              : 'integration-failed',
          code:
            integrated.integrationStatus === 'conflict'
              ? 'subagent-integration-conflict'
              : 'subagent-integration-failed',
          phase: 'integration',
          retryable: false,
        }),
      };
    }
    return integrated;
  } catch (error) {
    return {
      ...result,
      integrationStatus: 'conflict',
      error: toError(error).message,
      failure: createPersistedFailure(error, {
        kind: 'integration-conflict',
        code: 'subagent-integration-conflict',
        phase: 'integration',
        retryable: false,
      }),
    };
  }
}
