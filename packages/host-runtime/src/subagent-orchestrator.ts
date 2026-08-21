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
  SubagentInvocation,
  SubagentInvocationActivity,
  SubagentInvocationStatus,
  SubagentProviderEnvelope,
  SubagentRuntimeSnapshot,
  SubagentTaskResult,
  SubagentTaskRunInput,
  SubagentTaskRunner,
  SubagentTaskSpec,
  SubagentWorkspaceLease,
  EphemeralProviderSecret,
  ModelRef,
  PiwinConfig,
} from '@piwin/contracts';
import {
  invocationActivityForResult,
  invocationStatusForResult,
} from './subagent-invocation-state.js';
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
import type {
  SubagentIntegrationControl,
  SubagentIntegrationCoordinator,
} from './subagent-integration-coordinator.js';
import { createPersistedFailure, redactPersistedMessage } from './persisted-error-redaction.js';

/** Backend seam: allocates workspace leases (readonly or worktree). */
export type SubagentWorkspaceService = {
  acquire(task: SubagentTaskSpec): Promise<SubagentWorkspaceLease>;
  release(lease: SubagentWorkspaceLease): Promise<void>;
};

/** Optional durable run manifest store. */
export type SubagentRunStorePort = {
  createManifest(runId: string, request: SubagentBatchRequest): Promise<unknown>;
  loadManifest?: (runId: string) => Promise<
    | {
        status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration';
        results: Record<string, SubagentTaskResult>;
      }
    | undefined
  >;
  recordSnapshot?: (
    runId: string,
    taskId: string,
    snapshot: SubagentRuntimeSnapshot,
  ) => Promise<void>;
  recordLease?: (runId: string, taskId: string, lease: SubagentWorkspaceLease) => Promise<void>;
  recordResult(runId: string, taskId: string, result: SubagentTaskResult): Promise<void>;
  recordInvocation?: (runId: string, invocation: SubagentInvocation) => Promise<void>;
  setStatus(
    runId: string,
    status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration',
  ): Promise<void>;
  requestCancel?: (runId: string) => Promise<boolean>;
  waitForCancel?: (runId: string, signal?: AbortSignal) => Promise<boolean>;
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
  preflight?: SubagentTaskPreflightContext;
};

/** Host-only, in-memory snapshot produced before child allocation. */
export type SubagentTaskPreflightContext = {
  config: PiwinConfig;
  effectiveModel?: ModelRef;
  resolvedProviderSecrets: ReadonlyArray<{
    providerId: string;
    apiKeyRef: string;
    value: string;
  }>;
};

export type PreparedSubagentTask = {
  runtimeSnapshot: SubagentRuntimeSnapshot;
  sessionBlueprint: BackendSessionBlueprint;
  preparedPrompt: BackendPreparedPrompt;
  seedMessages?: readonly import('@piwin/contracts').SessionSeedMessage[];
  /**
   * Provider runtime envelope compiled by the parent — frozen before dispatch.
   * The worker must not resolve secrets itself; the orchestrator passes the
   * compiled envelope through so the runner can construct model clients.
   */
  providers: SubagentProviderEnvelope[];
  /** In-memory secret material paired with bootstrap auth descriptors. */
  providerSecrets?: readonly EphemeralProviderSecret[];
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
  /** Check selected-provider credentials before allocating a child identity. */
  preflightTask?: (input: {
    parentSessionId: string;
    task: SubagentTaskSpec;
  }) => Promise<SubagentTaskPreflightContext | void>;
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
  /** Record the user task only after continuation history has been captured. */
  recordTaskPrompt?: (input: {
    childSessionId: string;
    task: SubagentTaskSpec;
  }) => void | Promise<void>;
  /** Remove the transient child context after the task runner has joined. */
  unregisterTaskSession?: (childSessionId: string) => void | Promise<void>;
  /**
   * Persist/project a task result independently from best-effort push delivery.
   * Once a child shell exists this callback is the durable terminal-state seam.
   */
  onTaskResult?: (input: {
    parentSessionId: string;
    result: SubagentTaskResult;
  }) => void | Promise<void>;
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
  invocations: Map<string, SubagentInvocation>;
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

function invocationActivityKey(activity: SubagentInvocationActivity): string {
  switch (activity.kind) {
    case 'tool':
      return `${activity.kind}:${activity.toolName}:${activity.title ?? ''}`;
    case 'permission':
      return `${activity.kind}:${activity.action}`;
    case 'completed':
      return `${activity.kind}:${activity.summary ?? ''}`;
    case 'needs-integration':
      return `${activity.kind}:${activity.message ?? ''}`;
    case 'failed':
      return `${activity.kind}:${activity.message ?? ''}`;
    default:
      return activity.kind;
  }
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
  private readonly prepareTask: (
    input: SubagentTaskPreparationInput,
  ) => Promise<PreparedSubagentTask>;
  private readonly preflightTask: SubagentOrchestratorOptions['preflightTask'];
  private readonly integrationCoordinator: SubagentIntegrationCoordinator;
  private readonly resourceCoordinator: RuntimeResourceCoordinator | undefined;
  private readonly runRegistry: RunRegistry;
  private readonly runStore: SubagentRunStorePort | undefined;
  private readonly push: (message: HostPush) => void;
  private readonly getRuntimeGenerationId: (parentSessionId: string) => string;
  private readonly registerTaskSession: SubagentOrchestratorOptions['registerTaskSession'];
  private readonly unregisterTaskSession: SubagentOrchestratorOptions['unregisterTaskSession'];
  private readonly recordTaskPrompt: SubagentOrchestratorOptions['recordTaskPrompt'];
  private readonly onTaskResult: SubagentOrchestratorOptions['onTaskResult'];
  /** Active batches keyed by runId. */
  private readonly activeBatches = new Map<string, BatchState>();

  constructor(options: SubagentOrchestratorOptions) {
    if (typeof options.prepareTask !== 'function') {
      throw new Error(
        'SubagentOrchestrator requires prepareTask; task session inputs cannot be fabricated',
      );
    }
    if (typeof options.getRuntimeGenerationId !== 'function') {
      throw new Error('SubagentOrchestrator requires a getRuntimeGenerationId function');
    }

    this.taskRunner = options.taskRunner;
    this.workspaceService = options.workspaceService;
    this.prepareTask = options.prepareTask;
    this.preflightTask = options.preflightTask;
    this.integrationCoordinator = options.integrationCoordinator;
    this.resourceCoordinator = options.resourceCoordinator;
    this.runRegistry = options.runRegistry;
    this.runStore = options.runStore;
    this.push = options.push;
    this.getRuntimeGenerationId = options.getRuntimeGenerationId;
    this.registerTaskSession = options.registerTaskSession;
    this.unregisterTaskSession = options.unregisterTaskSession;
    this.recordTaskPrompt = options.recordTaskPrompt;
    this.onTaskResult = options.onTaskResult;
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
      throw new Error(
        `invalid subagent batch request: ${issues.map((issue) => issue.message).join('; ')}`,
      );
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
      invocations: new Map(),
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
    const cancelWaitController = new AbortController();
    let cancelWait: Promise<void> | undefined;

    try {
      if (this.runStore?.waitForCancel) {
        cancelWait = this.runStore
          .waitForCancel(batchState.runId, cancelWaitController.signal)
          .then((requested) => {
            if (requested) this.cancelBatchState(batchState);
          })
          .catch((error: unknown) => {
            if (!cancelWaitController.signal.aborted) {
              batchState.errors.push(toError(error));
            }
          });
      }
      await this.runStore?.createManifest(batchState.runId, batchState.request);
      for (const task of batchState.request.tasks) {
        await this.updateInvocation(batchState, task, {
          status: 'queued',
          activity: { kind: 'queued' },
        });
      }
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
      cancelWaitController.abort();
      if (cancelWait) await cancelWait;
    }

    try {
      await this.releaseWorkspaceLeases(batchState);
    } catch (error) {
      fatalError = fatalError
        ? combineErrors([fatalError, toError(error)], 'subagent batch cleanup failed')
        : toError(error);
    }

    if (!fatalError && batchState.errors.length > 0) {
      fatalError = combineErrors(
        batchState.errors,
        'subagent batch encountered persistence or push errors',
      );
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
        inFlight.set(
          taskId,
          this.dispatchTask(batchState.runId, task, batchState.schedulerState, batchState),
        );
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
      await this.recordTaskResult(batchState, fallback);
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
    this.runRegistry.terminate(batchState.runId, terminalStatus, terminalCode);

    const result: SubagentBatchResult = {
      runId: batchState.runId,
      status: batchStatus,
      results: batchState.request.tasks.flatMap((task) => {
        const taskResult = batchState.results.get(task.id);
        return taskResult ? [taskResult] : [];
      }),
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
      { resourceKind: 'agent-execution'; runId: string; acquiredAt: string } | undefined;
    let taskRunId: string | undefined;
    let childSessionId: string | undefined;
    const runtimeGenerationId = batchState.runtimeGenerationId;
    let taskSessionRegistered = false;
    let worktreeHandled = false;
    let integrationCommitPointReached = false;

    try {
      await this.updateInvocation(batchState, task, {
        status: 'starting',
        activity: { kind: 'preparing' },
      });
      // Credential/model preflight deliberately runs before resource,
      // workspace, child-run, and child-session allocation. A missing secret
      // must not leave a durable empty reviewer session behind.
      const preflight = await this.preflightTask?.({
        parentSessionId: task.parentSessionId,
        task,
      });
      // SC-14: Acquire resource slot if coordinator is available.
      if (this.resourceCoordinator) {
        const signal = this.runRegistry.getSignal(runId);
        if (!signal) {
          throw new Error(`batch run signal unavailable: ${runId}`);
        }
        resourceLease = await this.resourceCoordinator.acquire(`${runId}:${task.id}`, signal);
      }

      lease = await this.workspaceService.acquire(task);
      batchState.leases.set(task.id, lease);
      await this.runStore?.recordLease?.(runId, task.id, lease);

      // Check for cancellation before creating child run — avoids creating a
      // detached child after parent admission has closed.
      if (!this.isTaskAdmitted(state, task.id, batchState)) {
        return;
      }

      childSessionId = task.continuationSessionId ?? randomUUID();
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
      await this.updateInvocation(batchState, task, {
        status: 'running',
        activity: { kind: 'thinking' },
        childSessionId,
      });

      const prepared = await this.prepareTask({
        runId,
        taskRunId,
        childSessionId,
        runtimeGenerationId,
        task,
        workspaceLease: lease,
        ...(preflight ? { preflight } : {}),
      });
      await this.runStore?.recordSnapshot?.(runId, task.id, prepared.runtimeSnapshot);
      await this.recordTaskPrompt?.({
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
        ...(task.role ? { role: task.role } : {}),
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
        (result.integrationStatus === 'pending' || result.integrationStatus === 'not-requested')
      ) {
        const applyPolicy = task.applyPolicy ?? 'auto';
        if (applyPolicy === 'auto' && task.retainWorktree !== true) {
          result = await this.integrateTask(result, lease, {
            signal,
            onCommitPoint: () => {
              integrationCommitPointReached = true;
            },
          });
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

      if (!this.isTaskAdmitted(state, task.id, batchState) && !integrationCommitPointReached) {
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
        ...(task.allowedOutputPaths !== undefined
          ? { allowedOutputPaths: [...task.allowedOutputPaths] }
          : {}),
      };
      if (lease?.mode === 'worktree') {
        await this.integrationCoordinator.retain(
          lease.worktreePath,
          `task ${task.id} failed before integration: ${redactPersistedMessage(message)}`,
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
        await this.unregisterTaskSession?.(childSessionId);
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

  private isTaskAdmitted(state: SchedulerState, taskId: string, batchState: BatchState): boolean {
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
    const task = batchState.schedulerState.tasks.get(result.taskId);
    if (task) {
      await this.updateInvocation(batchState, task, {
        status: invocationStatusForResult(result),
        activity: invocationActivityForResult(result),
        ...(result.childSessionId ? { childSessionId: result.childSessionId } : {}),
      });
    }
    try {
      await this.onTaskResult?.({
        parentSessionId: batchState.request.parentSessionId,
        result,
      });
    } catch (error) {
      batchState.errors.push(toError(error));
    }
  }

  private async updateInvocation(
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
      await this.runStore?.recordInvocation?.(batchState.runId, invocation);
    } catch (error) {
      batchState.errors.push(toError(error));
    }
    this.emitPush(batchState, {
      type: 'subagent/invocation-updated',
      parentSessionId: task.parentSessionId,
      invocation,
    });
  }

  /** Persist a low-frequency, display-safe activity transition from child events. */
  async updateInvocationActivity(
    invocationId: string,
    activity: SubagentInvocationActivity,
  ): Promise<void> {
    for (const batchState of this.activeBatches.values()) {
      const current = batchState.invocations.get(invocationId);
      if (!current || current.status !== 'running') continue;
      const task = batchState.schedulerState.tasks.get(current.taskId);
      if (!task) return;
      await this.updateInvocation(batchState, task, {
        status: 'running',
        activity,
        ...(current.childSessionId ? { childSessionId: current.childSessionId } : {}),
      });
      return;
    }
  }

  /** Integrate a completed worktree task's changes. */
  private async integrateTask(
    result: SubagentTaskResult,
    lease: SubagentWorkspaceLease,
    control?: SubagentIntegrationControl,
  ): Promise<SubagentTaskResult> {
    if (lease.mode === 'readonly') return result;

    try {
      const integrated = await this.integrationCoordinator.integrate(result, lease, control);
      if (
        (integrated.integrationStatus === 'conflict' ||
          integrated.integrationStatus === 'failed') &&
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
    const results = [...batch.results.values()].sort((a, b) => a.taskId.localeCompare(b.taskId));
    return {
      runId,
      status: 'running',
      results,
    };
  }
}
