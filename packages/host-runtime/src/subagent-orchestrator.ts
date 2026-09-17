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

import type {
  HostPush,
  SubagentBatchProjection,
  SubagentBatchRequest,
  SubagentBatchResult,
  SubagentInvocationActivity,
  SubagentTaskRunner,
} from '@piwin/contracts';
import { validateSubagentBatchRequest } from '@piwin/contracts';
import {
  cancelAll,
  initSchedulerState,
  isBatchSettled,
  markTaskRunning,
  nextReadyBatch,
} from './subagent-scheduler.js';
import type { RunRegistry } from './run-registry.js';
import type { RuntimeResourceCoordinator } from './runtime-resource-coordinator.js';
import type { SubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';
import {
  combineErrors,
  createAcceptedLatch,
  createCompletionLatch,
  toError,
  type BatchState,
  type SubagentOrchestratorContext,
} from './subagent-orchestrator-batch.js';
import {
  detachCancelledBatch,
  finalizeBatch,
  releaseWorkspaceLeases,
} from './subagent-orchestrator-finalize.js';
import { updateInvocation } from './subagent-orchestrator-invocation.js';
import { dispatchTask } from './subagent-orchestrator-task.js';
import type {
  PreparedSubagentTask,
  SubagentBatchHandle,
  SubagentBatchOwnerRecord,
  SubagentOrchestratorOptions,
  SubagentRunStorePort,
  SubagentTaskPreparationInput,
  SubagentWorkspaceService,
} from './subagent-orchestrator-types.js';

export type {
  PreparedSubagentTask,
  SubagentBatchHandle,
  SubagentBatchOwnerRecord,
  SubagentIntegrationPort,
  SubagentOrchestratorOptions,
  SubagentRunStorePort,
  SubagentTaskPreparationInput,
  SubagentTaskPreflightContext,
  SubagentWorkspaceService,
} from './subagent-orchestrator-types.js';

/** How long a cancel request waits for a batch's runners to unwind. */
export const SUBAGENT_CANCEL_ACK_TIMEOUT_MS = 10_000;

export type SubagentBatchCancelStatus =
  /** The batch finished unwinding within the deadline. */
  | 'cancelled'
  /** Runners missed the deadline; run tree and waiters were settled as cancelled. */
  | 'detached'
  /** Not active in this Host; a durable cancel request was recorded. */
  | 'requested';

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
  private readonly freezeChildResult: SubagentOrchestratorOptions['freezeChildResult'];
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
    this.freezeChildResult = options.freezeChildResult;
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

    const schedulerState = initSchedulerState({
      ...request,
      ...(request.maxConcurrency === undefined && this.resourceCoordinator
        ? { maxConcurrency: this.resourceCoordinator.getStatus().effectiveMaxConcurrency }
        : {}),
    });

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
    const acceptedLatch = createAcceptedLatch();
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
      ...acceptedLatch,
      ...completionLatch,
    };
    this.activeBatches.set(runId, batchState);

    // Defer all asynchronous setup and task execution until this method has
    // returned, so callers can safely use the handle for cancellation.
    queueMicrotask(() => {
      void this.executeBatch(batchState);
    });

    // Spawn/plan callers only await completion; observe accepted to avoid
    // unhandled rejections when durable persistence fails.
    void batchState.accepted.catch(() => {});
    return {
      runId,
      accepted: batchState.accepted,
      hasAccepted: batchState.hasAccepted,
      completion: batchState.completion,
    };
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
    const deps = this.context();

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
        await updateInvocation(deps, batchState, task, {
          status: 'queued',
          activity: { kind: 'queued' },
        });
      }
      if (batchState.errors.length > 0) {
        throw combineErrors(
          batchState.errors,
          'subagent batch acceptance persistence failed',
        );
      }
      batchState.resolveAccepted();
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
      batchState.rejectAccepted(fatalError);
      cancelAll(batchState.schedulerState);
      this.runRegistry.cancelRun(batchState.runId);
    } finally {
      cancelWaitController.abort();
      if (cancelWait) await cancelWait;
    }

    try {
      await releaseWorkspaceLeases(deps, batchState);
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
      const result = await finalizeBatch(
        deps,
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
    const deps = this.context();

    while (!isBatchSettled(batchState.schedulerState) && !batchState.schedulerState.cancelled) {
      const ready = nextReadyBatch(batchState.schedulerState);
      for (const taskId of ready) {
        const task = batchState.schedulerState.tasks.get(taskId);
        if (!task || batchState.schedulerState.status.get(taskId) !== 'pending') continue;
        markTaskRunning(batchState.schedulerState, taskId);
        inFlight.set(
          taskId,
          dispatchTask(deps, batchState.runId, task, batchState.schedulerState, batchState),
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

  private emitPush(batchState: BatchState, message: HostPush): void {
    try {
      this.push(message);
    } catch (error) {
      batchState.errors.push(toError(error));
    }
  }

  /** Persist a low-frequency, display-safe activity transition from child events. */
  /** Current activity of a running invocation, for callers that restore it later. */
  getRunningInvocationActivity(invocationId: string): SubagentInvocationActivity | undefined {
    for (const batchState of this.activeBatches.values()) {
      const current = batchState.invocations.get(invocationId);
      if (current?.status === 'running') return current.activity;
    }
    return undefined;
  }

  async updateInvocationActivity(
    invocationId: string,
    activity: SubagentInvocationActivity,
  ): Promise<void> {
    for (const batchState of this.activeBatches.values()) {
      const current = batchState.invocations.get(invocationId);
      if (!current || current.status !== 'running') continue;
      const task = batchState.schedulerState.tasks.get(current.taskId);
      if (!task) return;
      await updateInvocation(this.context(), batchState, task, {
        status: 'running',
        activity,
        ...(current.childSessionId ? { childSessionId: current.childSessionId } : {}),
      });
      return;
    }
  }

  /**
   * Cancel a running batch and join its completion within a deadline. A batch
   * whose runners never unwind is detached so callers and waiters return.
   */
  async cancelBatch(
    runId: string,
    options: { initiator?: 'user'; timeoutMs?: number } = {},
  ): Promise<SubagentBatchCancelStatus> {
    const batchState = this.activeBatches.get(runId);
    if (!batchState) {
      await this.runStore?.requestCancel?.(runId);
      return 'requested';
    }

    if (options.initiator === 'user') {
      batchState.cancelledByUser = true;
    }
    this.cancelBatchState(batchState);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outcome = await Promise.race([
      batchState.completion.then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(
          () => resolve('timeout'),
          options.timeoutMs ?? SUBAGENT_CANCEL_ACK_TIMEOUT_MS,
        );
      }),
    ]);
    clearTimeout(timer);
    if (outcome === 'settled') return 'cancelled';
    const message = 'Subagent did not acknowledge cancellation in time and was detached.';
    this.push({
      type: 'host/log',
      level: 'warn',
      message: `subagent batch ${runId} cancellation timed out; detached`,
    });
    await detachCancelledBatch(this.context(), batchState, message);
    return 'detached';
  }

  /** Cancel every batch owned by a parent plan or foreground Run. */
  cancelBatchesForParentRun(parentRunId: string): void {
    for (const batchState of this.activeBatches.values()) {
      if (batchState.parentRunId === parentRunId) {
        this.cancelBatchState(batchState);
      }
    }
  }

  async lookupBatchOwner(runId: string): Promise<SubagentBatchOwnerRecord | undefined> {
    const active = this.activeBatches.get(runId);
    if (active) {
      return {
        runId,
        parentSessionId: active.request.parentSessionId,
        ...(active.parentRunId ? { parentRunId: active.parentRunId } : {}),
        invocationIds: uniqueInvocationIds(active.request.tasks, active.invocations),
        active: true,
        status: 'running',
      };
    }
    const manifest = await this.runStore?.loadManifest?.(runId);
    if (!manifest || typeof manifest.parentSessionId !== 'string' || !manifest.parentSessionId) {
      return undefined;
    }
    const parentRunId =
      manifest.parentRunId ??
      firstDefined(
        Object.values(manifest.invocations ?? {}).map((invocation) => invocation.parentRunId),
      ) ??
      firstDefined((manifest.tasks ?? []).map((task) => task.parentRunId));
    return {
      runId,
      parentSessionId: manifest.parentSessionId,
      ...(parentRunId ? { parentRunId } : {}),
      invocationIds: uniqueInvocationIds(manifest.tasks ?? [], manifest.invocations ?? {}),
      active: false,
      status: manifest.status,
    };
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
        configured: status.configuredMaxConcurrentRuns,
        effective: status.effectiveMaxConcurrentRuns,
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

  private context(): SubagentOrchestratorContext {
    return {
      taskRunner: this.taskRunner,
      workspaceService: this.workspaceService,
      prepareTask: this.prepareTask,
      preflightTask: this.preflightTask,
      integrationCoordinator: this.integrationCoordinator,
      resourceCoordinator: this.resourceCoordinator,
      runRegistry: this.runRegistry,
      runStore: this.runStore,
      registerTaskSession: this.registerTaskSession,
      unregisterTaskSession: this.unregisterTaskSession,
      recordTaskPrompt: this.recordTaskPrompt,
      onTaskResult: this.onTaskResult,
      freezeChildResult: this.freezeChildResult,
      emitPush: (batchState, message) => this.emitPush(batchState, message),
      activeBatches: this.activeBatches,
    };
  }
}

function firstDefined(values: ReadonlyArray<string | undefined>): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function uniqueInvocationIds(
  tasks: ReadonlyArray<{ invocationId?: string }>,
  invocations: Record<string, { id: string }> | Map<string, { id: string }>,
): string[] {
  const ids = new Set<string>();
  for (const task of tasks) {
    if (task.invocationId) ids.add(task.invocationId);
  }
  const recorded = invocations instanceof Map ? invocations.keys() : Object.keys(invocations);
  for (const id of recorded) {
    if (id) ids.add(id);
  }
  return [...ids];
}
