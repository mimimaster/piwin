/**
 * CE-SUB-ORCH: Host-owned subagent orchestrator.
 *
 * Owns batch scheduling and failure policy only. It does not own Pi process
 * code, session transition code, or Git operations. It delegates to:
 * - `SubagentTaskRunner` (from contracts) for Pi session/process execution
 * - `SubagentWorkspaceService` for workspace leases
 * - `SubagentIntegrationCoordinator` for serialized code integration
 * - `SubagentLifecycleService` for child state transitions
 * - `SubagentRunStore` for durable run manifests
 * - `RunRegistry` for run lifecycle and cancellation
 * - `RuntimeResourceCoordinator` for bounded resource acquisition
 *
 * The orchestrator is the single entry point for batch starts called by the
 * model tool, plan execution, and Desktop controls.
 *
 * SC-03: Plan, model tools, Desktop, and CLI call one SubagentOrchestrator.
 * SC-04: Batch start returns a stable runId immediately.
 * SC-05: Scheduling is work-conserving, not fixed Promise waves.
 * SC-06: Product concurrency above one requires processIsolation=true.
 * SC-07: Isolation is a backend fact; callers do not send a process-policy switch.
 * SC-08: Parent cancellation closes admission before aborting descendants.
 * SC-09: A parent cannot become terminal while a descendant is non-terminal.
 * SC-10: Parallel writes use one worktree per child and serialized integration.
 * SC-11: Execution, summary merge, and code integration remain separate axes.
 * SC-12: Integration conflict makes the Run failed with integration-required.
 * SC-13: No automatic task retry. Retry creates new run/task identities.
 */

import { randomUUID } from 'node:crypto';
import type {
  BackendPreparedPrompt,
  BackendSessionBlueprint,
  HostPush,
  SubagentBatchRequest,
  SubagentBatchProjection,
  SubagentBatchResult,
  SubagentProviderEnvelope,
  SubagentRuntimeSnapshot,
  SubagentTaskResult,
  SubagentTaskRunInput,
  SubagentTaskRunner,
  SubagentTaskSpec,
  SubagentWorkspaceLease,
} from '@piwin/contracts';
import { validateSubagentBatchRequest } from '@piwin/contracts';
import {
  cancelAll,
  deriveBatchStatus,
  initSchedulerState,
  isBatchSettled,
  markTaskRunning,
  markTaskSettled,
  nextReadyBatch,
  type SchedulerState,
} from './subagent-scheduler.js';
import { RunRegistry } from './run-registry.js';
import type { RuntimeResourceCoordinator } from './runtime-resource-coordinator.js';
import type { SubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';

/** Backend seam: allocates workspace leases (readonly or worktree). */
export type SubagentWorkspaceService = {
  acquire(task: SubagentTaskSpec): Promise<SubagentWorkspaceLease>;
  release(lease: SubagentWorkspaceLease): Promise<void>;
};

/** Optional durable run manifest store. */
export type SubagentRunStorePort = {
  createManifest(runId: string, request: SubagentBatchRequest): Promise<unknown>;
  loadManifest?: (runId: string) => Promise<{
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration';
    results: Record<string, SubagentTaskResult>;
  } | undefined>;
  recordResult(runId: string, taskId: string, result: SubagentTaskResult): Promise<void>;
  setStatus(
    runId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration',
  ): Promise<void>;
  requestCancel?: (runId: string) => Promise<boolean>;
  isCancelRequested?: (runId: string) => Promise<boolean>;
  clearCancelRequest?: (runId: string) => Promise<void>;
};

/** Legacy integration port type — kept as an exported type for backward compat. */
export type SubagentIntegrationPort = {
  integrate(result: SubagentTaskResult): Promise<SubagentTaskResult>;
  retain(result: SubagentTaskResult): Promise<void>;
};

export type SubagentTaskPreparationInput = {
  runId: string;
  taskRunId: string;
  childSessionId: string;
  runtimeGenerationId: string;
  task: SubagentTaskSpec;
  workspaceLease: SubagentWorkspaceLease;
};

export type PreparedSubagentTask = {
  runtimeSnapshot: SubagentRuntimeSnapshot;
  sessionBlueprint: BackendSessionBlueprint;
  preparedPrompt: BackendPreparedPrompt;
  /**
   * Provider runtime envelope compiled by the parent — frozen before dispatch.
   * The worker must not resolve secrets itself; the orchestrator passes the
   * compiled envelope through so the runner can construct model clients.
   */
  providers: SubagentProviderEnvelope[];
};

/** Synchronously accepted batch identity and its eventual completion. */
export type SubagentBatchHandle = {
  runId: string;
  completion: Promise<SubagentBatchResult>;
};

export type SubagentOrchestratorOptions = {
  /** Task runner backend (from contracts — has processIsolation capability). */
  taskRunner: SubagentTaskRunner;
  workspaceService: SubagentWorkspaceService;
  /** Compile the exact runtime and prompt inputs before child dispatch. */
  prepareTask: (input: SubagentTaskPreparationInput) => Promise<PreparedSubagentTask>;
  /** Serialized code integration coordinator (required). */
  integrationCoordinator: SubagentIntegrationCoordinator;
  /** Resource coordinator for bounded concurrency. */
  resourceCoordinator?: RuntimeResourceCoordinator;
  /** Run registry for run lifecycle management (required). */
  runRegistry: RunRegistry;
  runStore?: SubagentRunStorePort;
  push: (message: HostPush) => void;
  /**
   * Dynamic runtime generation ID getter. Called with the parent session ID
   * from each batch request so the correct generation is resolved per batch.
   */
  getRuntimeGenerationId: (parentSessionId: string) => string;
  /** Register the child context before its worker can call Host tools. */
  registerTaskSession?: (input: {
    childSessionId: string;
    parentSessionId: string;
    runtimeGenerationId: string;
    workingDirectory: string;
    task: SubagentTaskSpec;
    workspaceLease: SubagentWorkspaceLease;
  }) => void | Promise<void>;
  /** Remove the transient child context after the task runner has joined. */
  unregisterTaskSession?: (childSessionId: string) => void;
};

/** Internal state for an active batch. */
interface BatchState {
  runId: string;
  runtimeGenerationId: string;
  parentRunId?: string;
  request: SubagentBatchRequest;
  schedulerState: SchedulerState;
  results: Map<string, SubagentTaskResult>;
  leases: Map<string, SubagentWorkspaceLease>;
  taskRunIds: Map<string, string>;
  errors: Error[];
  completion: Promise<SubagentBatchResult>;
  resolveCompletion: (result: SubagentBatchResult) => void;
  rejectCompletion: (error: Error) => void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function combineErrors(errors: readonly Error[], message: string): Error {
  const firstError = errors[0];
  if (errors.length === 1 && firstError) return firstError;
  return new AggregateError(errors, message);
}

function createCompletionLatch(): {
  completion: Promise<SubagentBatchResult>;
  resolveCompletion: (result: SubagentBatchResult) => void;
  rejectCompletion: (error: Error) => void;
} {
  let resolveCompletion: ((result: SubagentBatchResult) => void) | undefined;
  let rejectCompletion: ((error: Error) => void) | undefined;
  const completion = new Promise<SubagentBatchResult>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  if (!resolveCompletion || !rejectCompletion) {
    throw new Error('batch completion latch was not initialized');
  }

  return { completion, resolveCompletion, rejectCompletion };
}

export class SubagentOrchestrator {
  private readonly taskRunner: SubagentTaskRunner;
  private readonly workspaceService: SubagentWorkspaceService;
  private readonly prepareTask: (input: SubagentTaskPreparationInput) => Promise<PreparedSubagentTask>;
  private readonly integrationCoordinator: SubagentIntegrationCoordinator;
  private readonly resourceCoordinator: RuntimeResourceCoordinator | undefined;
  private readonly runRegistry: RunRegistry;
  private readonly runStore: SubagentRunStorePort | undefined;
  private readonly push: (message: HostPush) => void;
  private readonly getRuntimeGenerationId: (parentSessionId: string) => string;
  private readonly registerTaskSession: SubagentOrchestratorOptions['registerTaskSession'];
  private readonly unregisterTaskSession: SubagentOrchestratorOptions['unregisterTaskSession'];
  /** Active batches keyed by runId. */
  private readonly activeBatches = new Map<string, BatchState>();

  constructor(options: SubagentOrchestratorOptions) {
    if (typeof options.prepareTask !== 'function') {
      throw new Error('SubagentOrchestrator requires prepareTask; task session inputs cannot be fabricated');
    }
    if (typeof options.getRuntimeGenerationId !== 'function') {
      throw new Error('SubagentOrchestrator requires a getRuntimeGenerationId function');
    }

    this.taskRunner = options.taskRunner;
    this.workspaceService = options.workspaceService;
    this.prepareTask = options.prepareTask;
    this.integrationCoordinator = options.integrationCoordinator;
    this.resourceCoordinator = options.resourceCoordinator;
    this.runRegistry = options.runRegistry;
    this.runStore = options.runStore;
    this.push = options.push;
    this.getRuntimeGenerationId = options.getRuntimeGenerationId;
    this.registerTaskSession = options.registerTaskSession;
    this.unregisterTaskSession = options.unregisterTaskSession;
  }

  /**
   * Accept a batch synchronously and start scheduling on the next microtask.
   *
   * The acceptance path owns validation, RunRegistry admission, and the
   * active-batch entry. No transport needs to remain open while tasks run.
   */
  startBatch(request: SubagentBatchRequest, parentRunId?: string): SubagentBatchHandle {
    const issues = validateSubagentBatchRequest(request);
    if (issues.length > 0) {
      throw new Error(`invalid subagent batch request: ${issues.map((issue) => issue.message).join('; ')}`);
    }

    const schedulerState = initSchedulerState(request);

    // SC-06: Clamp effective concurrency based on processIsolation.
    if (!this.taskRunner.capabilities.processIsolation) {
      schedulerState.maxConcurrency = 1;
    }

    // Fix #7: Sync scheduler maxConcurrency with resource coordinator.
    if (this.resourceCoordinator) {
      const status = this.resourceCoordinator.getStatus();
      schedulerState.maxConcurrency = Math.min(
        schedulerState.maxConcurrency,
        status.effectiveMaxConcurrency,
      );
    }

    const runtimeGenerationId = this.getRuntimeGenerationId(request.parentSessionId);
    const batchRun = this.runRegistry.create({
      kind: 'subagent-batch',
      sessionId: request.parentSessionId,
      runtimeGenerationId,
      ...(parentRunId ? { parentRunId } : {}),
    });
    const runId = batchRun.runId;
    this.runRegistry.start(runId);

    const completionLatch = createCompletionLatch();
    const batchState: BatchState = {
      runId,
      runtimeGenerationId,
      ...(parentRunId ? { parentRunId } : {}),
      request,
      schedulerState,
      results: new Map(),
      leases: new Map(),
      taskRunIds: new Map(),
      errors: [],
      ...completionLatch,
    };
    this.activeBatches.set(runId, batchState);

    // Defer all asynchronous setup and task execution until this method has
    // returned, so callers can safely use the handle for cancellation.
    queueMicrotask(() => {
      void this.executeBatch(batchState);
    });

    return { runId, completion: batchState.completion };
  }

  /** Compatibility helper for callers that still await batch completion. */
  async runBatch(request: SubagentBatchRequest): Promise<SubagentBatchResult> {
    const handle = this.startBatch(request);
    return handle.completion;
  }

  private async executeBatch(batchState: BatchState): Promise<void> {
    let fatalError: Error | undefined;
    const cancelPoll = this.runStore?.isCancelRequested
      ? setInterval(() => {
          void this.runStore?.isCancelRequested?.(batchState.runId).then((requested) => {
            if (requested) this.cancelBatchState(batchState);
          }).catch((error: unknown) => {
            batchState.errors.push(toError(error));
          });
        }, 100)
      : undefined;

    try {
      await this.runStore?.createManifest(batchState.runId, batchState.request);
      this.emitPush(batchState, {
        type: 'subagent/batch-updated',
        runId: batchState.runId,
        parentSessionId: batchState.request.parentSessionId,
        result: {
          runId: batchState.runId,
          status: 'running',
          results: [],
        },
      });
      if (!batchState.schedulerState.cancelled) {
        await this.runStore?.setStatus(batchState.runId, 'running');
        await this.executeScheduler(batchState);
      }
    } catch (error) {
      fatalError = toError(error);
      cancelAll(batchState.schedulerState);
      this.runRegistry.cancelRun(batchState.runId);
    } finally {
      if (cancelPoll !== undefined) clearInterval(cancelPoll);
    }

    try {
      await this.releaseWorkspaceLeases(batchState);
    } catch (error) {
      fatalError = fatalError
        ? combineErrors([fatalError, toError(error)], 'subagent batch cleanup failed')
        : toError(error);
    }

    if (!fatalError && batchState.errors.length > 0) {
      fatalError = combineErrors(batchState.errors, 'subagent batch encountered persistence or push errors');
    }

    try {
      const result = await this.finalizeBatch(
        batchState,
        fatalError ? 'failed' : undefined,
        fatalError,
      );
      await this.runStore?.clearCancelRequest?.(batchState.runId);
      if (fatalError || batchState.errors.length > 0) {
        batchState.rejectCompletion(
          fatalError ?? combineErrors(batchState.errors, 'subagent batch failed'),
        );
        return;
      }
      batchState.resolveCompletion(result);
    } catch (error) {
      batchState.rejectCompletion(toError(error));
    }
  }

  private async executeScheduler(batchState: BatchState): Promise<void> {
    const inFlight = new Map<string, Promise<void>>();
    let failFastTriggered = false;

    while (!isBatchSettled(batchState.schedulerState) && !batchState.schedulerState.cancelled) {
      const ready = nextReadyBatch(batchState.schedulerState);
      for (const taskId of ready) {
        const task = batchState.schedulerState.tasks.get(taskId);
        if (!task || batchState.schedulerState.status.get(taskId) !== 'pending') continue;
        markTaskRunning(batchState.schedulerState, taskId);
        inFlight.set(taskId, this.dispatchTask(batchState.runId, task, batchState.schedulerState, batchState));
      }

      if (inFlight.size === 0) {
        const hasPending = [...batchState.schedulerState.status.values()].some(
          (status) => status === 'pending',
        );
        if (hasPending) cancelAll(batchState.schedulerState);
        break;
      }

      const settledTaskId = await Promise.race(
        [...inFlight.entries()].map(async ([taskId, completion]) => {
          await completion;
          return taskId;
        }),
      );
      inFlight.delete(settledTaskId);

      if (
        batchState.schedulerState.failurePolicy === 'fail-fast' &&
        !failFastTriggered &&
        batchState.schedulerState.status.get(settledTaskId) === 'failed'
      ) {
        failFastTriggered = true;
        this.cancelBatchState(batchState);
      }
    }

    // Cancellation may have made every task terminal while runners are still
    // unwinding. Always join them before releasing workspaces.
    await Promise.all(inFlight.values());
  }

  private cancelBatchState(batchState: BatchState): void {
    cancelAll(batchState.schedulerState);
    this.runRegistry.cancelRun(batchState.runId);
  }

  private async releaseWorkspaceLeases(batchState: BatchState): Promise<void> {
    const releaseResults = await Promise.allSettled(
      [...batchState.leases.values()].map((lease) => this.workspaceService.release(lease)),
    );
    const releaseErrors = releaseResults.flatMap((result) =>
      result.status === 'rejected' ? [toError(result.reason)] : [],
    );
    if (releaseErrors.length > 0) {
      throw combineErrors(releaseErrors, 'one or more subagent workspace leases failed to release');
    }
  }

  private async finalizeBatch(
    batchState: BatchState,
    forcedStatus: 'failed' | undefined,
    fatalError: Error | undefined,
  ): Promise<SubagentBatchResult> {
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
    if (
      batchStatus === 'completed' &&
      (hasIntegrationFailure || fatalError)
    ) {
      batchStatus = 'failed';
    }

    try {
      await this.runStore?.setStatus(batchState.runId, batchStatus);
    } catch (error) {
      batchState.errors.push(toError(error));
      batchStatus = 'failed';
      try {
        await this.runStore?.setStatus(batchState.runId, 'failed');
      } catch (retryError) {
        batchState.errors.push(toError(retryError));
      }
    }

    const terminalStatus = batchStatus === 'completed'
      ? 'completed'
      : batchStatus === 'cancelled'
        ? 'cancelled'
        : 'failed';
    const terminalCode = batchStatus === 'needs-integration'
      ? 'integration-required'
      : batchStatus === 'failed'
        ? 'failed'
        : batchStatus === 'cancelled'
          ? 'cancelled'
          : 'completed';
    this.runRegistry.terminate(batchState.runId, terminalStatus, terminalCode);

    const result: SubagentBatchResult = {
      runId: batchState.runId,
      status: batchStatus,
      results: batchState.request.tasks.map((task) =>
        batchState.results.get(task.id) ?? {
          runId: batchState.runId,
          taskId: task.id,
          executionStatus: 'cancelled',
          summaryStatus: 'not-requested',
          integrationStatus: 'not-requested',
          ...(task.allowedOutputPaths !== undefined
            ? { allowedOutputPaths: [...task.allowedOutputPaths] }
            : {}),
        },
      ),
    };

    this.emitPush(batchState, {
      type: 'subagent/batch-updated',
      runId: batchState.runId,
      parentSessionId: batchState.request.parentSessionId,
      result,
    });
    this.activeBatches.delete(batchState.runId);
    return result;
  }

  private emitPush(batchState: BatchState, message: HostPush): void {
    try {
      this.push(message);
    } catch (error) {
      batchState.errors.push(toError(error));
    }
  }

  /** Dispatch a single task: acquire resource, workspace, run, settle, integrate. */
  private async dispatchTask(
    runId: string,
    task: SubagentTaskSpec,
    state: SchedulerState,
    batchState: BatchState,
  ): Promise<void> {
    let lease: SubagentWorkspaceLease | undefined;
    let resourceLease:
      | { resourceKind: 'agent-execution'; runId: string; acquiredAt: string }
      | undefined;
    let taskRunId: string | undefined;
    let childSessionId: string | undefined;
    const runtimeGenerationId = batchState.runtimeGenerationId;
    let taskSessionRegistered = false;
    let worktreeHandled = false;

    try {
      // SC-14: Acquire resource slot if coordinator is available.
      if (this.resourceCoordinator) {
        const signal = this.runRegistry.getSignal(runId);
        if (!signal) {
          throw new Error(`batch run signal unavailable: ${runId}`);
        }
        resourceLease = await this.resourceCoordinator.acquire(
          `${runId}:${task.id}`,
          signal,
        );
      }

      lease = await this.workspaceService.acquire(task);
      batchState.leases.set(task.id, lease);

      // Check for cancellation before creating child run — avoids creating a
      // detached child after parent admission has closed.
      if (!this.isTaskAdmitted(state, task.id, batchState)) {
        return;
      }

      childSessionId = randomUUID();
      const taskRun = this.runRegistry.create({
        kind: 'subagent-task',
        sessionId: childSessionId,
        parentRunId: runId,
        taskId: task.id,
        runtimeGenerationId,
      });
      taskRunId = taskRun.runId;
      batchState.taskRunIds.set(task.id, taskRunId);
      this.runRegistry.start(taskRunId);
      taskSessionRegistered = this.registerTaskSession !== undefined;
      await this.registerTaskSession?.({
        childSessionId,
        parentSessionId: task.parentSessionId,
        runtimeGenerationId,
        workingDirectory: lease.cwd,
        task,
        workspaceLease: lease,
      });

      const prepared = await this.prepareTask({
        runId,
        taskRunId,
        childSessionId,
        runtimeGenerationId,
        task,
        workspaceLease: lease,
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
        providers: prepared.providers,
      };

      const signal = this.runRegistry.getSignal(taskRunId);
      if (!signal) {
        throw new Error(`task run signal unavailable: ${taskRunId}`);
      }
      const output = await this.taskRunner.runTask(taskInput, signal);

      // A runner may ignore abort and return late. Once admission is closed,
      // its result is intentionally discarded and cannot revive the task.
      if (!this.isTaskAdmitted(state, task.id, batchState)) {
        return;
      }

      let result: SubagentTaskResult = {
        runId,
        taskId: task.id,
        childSessionId: output.childSessionId ?? childSessionId,
        executionStatus: output.executionStatus,
        summaryStatus: output.summaryStatus,
        integrationStatus: output.integrationStatus,
        ...(task.profileId ? { profileId: task.profileId } : {}),
        ...(task.model ? { model: task.model } : {}),
        ...(output.summaryPreview ? { summaryPreview: output.summaryPreview } : {}),
        ...(output.changedFiles ? { changedFiles: output.changedFiles } : {}),
        ...(output.verification ? { verification: output.verification } : {}),
        ...(output.error ? { error: output.error } : {}),
        ...(lease?.worktreePath ? { worktreePath: lease.worktreePath } : {}),
        ...(task.allowedOutputPaths !== undefined
          ? { allowedOutputPaths: [...task.allowedOutputPaths] }
          : {}),
      };

      if (
        result.executionStatus !== 'completed' &&
        lease.mode === 'worktree' &&
        result.integrationStatus === 'not-requested'
      ) {
        await this.integrationCoordinator.retain(
          lease.worktreePath,
          `task ${task.id} ${result.executionStatus}; worktree retained for inspection`,
        );
        result = { ...result, integrationStatus: 'retained' };
        worktreeHandled = true;
      }

      if (
        result.executionStatus === 'completed' &&
        lease.mode === 'worktree' &&
        (result.integrationStatus === 'pending' ||
          result.integrationStatus === 'not-requested')
      ) {
        const applyPolicy = task.applyPolicy ?? 'auto';
        if (applyPolicy === 'auto' && task.retainWorktree !== true) {
          result = await this.integrateTask(result, lease);
          worktreeHandled = true;
        } else {
          await this.integrationCoordinator.retain(
            lease.worktreePath,
            applyPolicy === 'explicit'
              ? 'explicit integration policy; awaiting user-selected merge'
              : 'apply policy none; worktree retained by request',
          );
          result = { ...result, integrationStatus: 'retained' };
          worktreeHandled = true;
        }
      }

      if (!this.isTaskAdmitted(state, task.id, batchState)) {
        return;
      }

      batchState.results.set(task.id, result);
      await this.recordTaskResult(batchState, result);
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
        this.runRegistry.terminate(taskRunId, taskStatus);
      }

      this.emitPush(batchState, {
        type: 'subagent/task-updated',
        runId,
        parentSessionId: task.parentSessionId,
        result,
      });
    } catch (error) {
      // Cancellation and late backend failures do not replace the cancelled
      // terminal state with a synthetic failure.
      if (!this.isTaskAdmitted(state, task.id, batchState)) {
        return;
      }

      const message = toError(error).message;
      const failed: SubagentTaskResult = {
        runId,
        taskId: task.id,
        executionStatus: 'failed',
        summaryStatus: 'not-requested',
        integrationStatus: 'not-requested',
        error: message,
        ...(lease?.worktreePath ? { worktreePath: lease.worktreePath } : {}),
        ...(task.allowedOutputPaths !== undefined
          ? { allowedOutputPaths: [...task.allowedOutputPaths] }
          : {}),
      };
      if (lease?.mode === 'worktree') {
        await this.integrationCoordinator.retain(
          lease.worktreePath,
          `task ${task.id} failed before integration: ${message}`,
        );
        failed.integrationStatus = 'retained';
        worktreeHandled = true;
      }
      batchState.results.set(task.id, failed);
      await this.recordTaskResult(batchState, failed);
      markTaskSettled(state, task.id, 'failed');

      if (taskRunId) {
        this.runRegistry.terminate(taskRunId, 'failed', undefined, message);
      }

      this.emitPush(batchState, {
        type: 'subagent/task-updated',
        runId,
        parentSessionId: task.parentSessionId,
        result: failed,
      });
    } finally {
      // The task owner has now joined, including the late-return path after
      // cancellation. Cancellation only requests abort; this explicit
      // transition is the owner's acknowledgement that its work stopped.
      if (taskRunId && this.runRegistry.isActive(taskRunId)) {
        this.runRegistry.terminate(taskRunId, 'cancelled', 'cancelled');
      }
      if (taskSessionRegistered && childSessionId) {
        this.unregisterTaskSession?.(childSessionId);
      }
      if (lease?.mode === 'worktree' && !worktreeHandled) {
        await this.integrationCoordinator.retain(
          lease.worktreePath,
          `task ${task.id} ended before integration; worktree retained for inspection`,
        );
        worktreeHandled = true;
      }
      // A cancelled runner may return after admission has closed, so the
      // normal result path intentionally discards its late output. Persist a
      // cancellation result here so the child session does not remain stuck
      // in the running state and the durable manifest has a complete task.
      if (
        batchState.schedulerState.cancelled &&
        childSessionId &&
        !batchState.results.has(task.id)
      ) {
        const cancelled: SubagentTaskResult = {
          runId: batchState.runId,
          taskId: task.id,
          childSessionId,
          executionStatus: 'cancelled',
          summaryStatus: 'not-requested',
          integrationStatus: lease?.mode === 'worktree' ? 'retained' : 'not-requested',
          ...(lease?.worktreePath ? { worktreePath: lease.worktreePath } : {}),
          ...(task.allowedOutputPaths !== undefined
            ? { allowedOutputPaths: [...task.allowedOutputPaths] }
            : {}),
        };
        batchState.results.set(task.id, cancelled);
        await this.recordTaskResult(batchState, cancelled);
        this.emitPush(batchState, {
          type: 'subagent/task-updated',
          runId: batchState.runId,
          parentSessionId: task.parentSessionId,
          result: cancelled,
        });
      }
      // Release resource lease.
      if (resourceLease && this.resourceCoordinator) {
        this.resourceCoordinator.release(resourceLease);
      }
    }
  }

  private isTaskAdmitted(
    state: SchedulerState,
    taskId: string,
    batchState: BatchState,
  ): boolean {
    return (
      !state.cancelled &&
      this.runRegistry.get(batchState.runId)?.status !== 'cancelling' &&
      state.status.get(taskId) === 'running'
    );
  }

  private async recordTaskResult(
    batchState: BatchState,
    result: SubagentTaskResult,
  ): Promise<void> {
    try {
      await this.runStore?.recordResult(batchState.runId, result.taskId, result);
    } catch (error) {
      batchState.errors.push(toError(error));
    }
  }

  /** Integrate a completed worktree task's changes. */
  private async integrateTask(
    result: SubagentTaskResult,
    lease: SubagentWorkspaceLease,
  ): Promise<SubagentTaskResult> {
    if (lease.mode === 'readonly') return result;

    try {
      return await this.integrationCoordinator.integrate(result, lease);
    } catch (error) {
      return {
        ...result,
        integrationStatus: 'conflict',
        error: toError(error).message,
      };
    }
  }

  /** Cancel a running batch and join its completion. */
  async cancelBatch(runId: string): Promise<void> {
    const batchState = this.activeBatches.get(runId);
    if (!batchState) {
      await this.runStore?.requestCancel?.(runId);
      return;
    }

    this.cancelBatchState(batchState);
    await batchState.completion;
  }

  /** Cancel every batch owned by a parent plan or foreground Run. */
  cancelBatchesForParentRun(parentRunId: string): void {
    for (const batchState of this.activeBatches.values()) {
      if (batchState.parentRunId === parentRunId) {
        this.cancelBatchState(batchState);
      }
    }
  }

  async getBatch(runId: string): Promise<SubagentBatchResult | undefined> {
    const active = this.activeBatches.get(runId);
    if (active) return undefined;
    const manifest = await this.runStore?.loadManifest?.(runId);
    if (!manifest || manifest.status === 'running') return undefined;
    return {
      runId,
      status: manifest.status,
      results: Object.values(manifest.results).sort((left, right) =>
        left.taskId.localeCompare(right.taskId),
      ),
    };
  }

  async joinBatch(runId: string): Promise<SubagentBatchResult> {
    const active = this.activeBatches.get(runId);
    if (active) return active.completion;
    const result = await this.getBatch(runId);
    if (!result) {
      throw new Error(`subagent batch not found or still running: ${runId}`);
    }
    return result;
  }

  async getBatchProjectionAsync(runId: string): Promise<SubagentBatchProjection> {
    const active = this.activeBatches.get(runId);
    if (active) return this.getBatchProjection(runId);
    const result = await this.getBatch(runId);
    if (result) return { runId, status: result.status, results: result.results };
    const manifest = await this.runStore?.loadManifest?.(runId);
    return manifest
      ? { runId, status: manifest.status, results: Object.values(manifest.results) }
      : { runId, status: 'unknown', results: [] };
  }

  /** Check if a batch is still running. */
  isRunning(runId: string): boolean {
    return this.activeBatches.has(runId);
  }

  /** Get effective concurrency status. */
  getConcurrencyStatus(): {
    configured: number;
    effective: number;
    processIsolation: boolean;
  } {
    if (this.resourceCoordinator) {
      const status = this.resourceCoordinator.getStatus();
      return {
        configured: status.configuredMaxConcurrency,
        effective: status.effectiveMaxConcurrency,
        processIsolation: status.processIsolation,
      };
    }
    // Without a resource coordinator, report based on task runner capability.
    const isolated = this.taskRunner.capabilities.processIsolation;
    return {
      configured: 4,
      effective: isolated ? 4 : 1,
      processIsolation: isolated,
    };
  }

  /**
   * Get a full projection of a batch: status + per-task results.
   * Returns a terminal projection when the batch is not active (already
   * settled or unknown). This is the shape CLI/Desktop consumes for
   * `subagent/batch-status`.
   */
  getBatchProjection(runId: string): SubagentBatchProjection {
    const batch = this.activeBatches.get(runId);
    if (!batch) {
      // Batch is not active — it either completed or was never started.
      // Return a minimal terminal projection. The caller can check the
      // run store for persisted results if needed.
      return { runId, status: 'unknown', results: [] };
    }
    const results = [...batch.results.values()].sort((a, b) =>
      a.taskId.localeCompare(b.taskId),
    );
    return {
      runId,
      status: 'running',
      results,
    };
  }
}
