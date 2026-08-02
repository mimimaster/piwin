/**
 * CE-SUB-ORCH: Host-owned subagent orchestrator.
 *
 * Owns batch scheduling and failure policy only. It does not own Pi process
 * code, session transition code, or Git operations. It delegates to:
 * - `SubagentTaskRunner` for Pi session/process execution
 * - `SubagentWorkspaceService` for workspace leases
 * - `SubagentIntegrationPort` for code integration
 * - `SubagentLifecycleService` for child state transitions
 * - `SubagentRunStore` for durable run manifests
 *
 * The orchestrator is the single entry point for `runBatch()` called by the
 * model tool and plan execution.
 */

import { randomUUID } from 'node:crypto';
import type {
  HostPush,
  SubagentBatchRequest,
  SubagentBatchResult,
  SubagentTaskResult,
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

/** Backend seam: runs a single task in an isolated Pi session/process. */
export type SubagentTaskRunner = {
  start(
    task: SubagentTaskSpec,
    workspace: SubagentWorkspaceLease,
    signal: AbortSignal,
  ): Promise<SubagentTaskResult>;
  cancel(childSessionId: string): Promise<void>;
};

/** Backend seam: allocates workspace leases (readonly or worktree). */
export type SubagentWorkspaceService = {
  acquire(task: SubagentTaskSpec): Promise<SubagentWorkspaceLease>;
  release(lease: SubagentWorkspaceLease): Promise<void>;
};

/** Backend seam: integrates write changes back to the parent branch. */
export type SubagentIntegrationPort = {
  integrate(result: SubagentTaskResult): Promise<SubagentTaskResult>;
  retain(result: SubagentTaskResult): Promise<void>;
};

/** Optional durable run manifest store. */
export type SubagentRunStorePort = {
  createManifest(runId: string, request: SubagentBatchRequest): Promise<unknown>;
  recordResult(runId: string, taskId: string, result: SubagentTaskResult): Promise<void>;
  setStatus(runId: string, status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration'): Promise<void>;
};

export type SubagentOrchestratorOptions = {
  taskRunner: SubagentTaskRunner;
  workspaceService: SubagentWorkspaceService;
  integrationPort?: SubagentIntegrationPort;
  runStore?: SubagentRunStorePort;
  push: (message: HostPush) => void;
};

export type ActiveRun = {
  runId: string;
  abortController: AbortController;
  state: SchedulerState;
};

export class SubagentOrchestrator {
  private readonly taskRunner: SubagentTaskRunner;
  private readonly workspaceService: SubagentWorkspaceService;
  private readonly integrationPort: SubagentIntegrationPort | undefined;
  private readonly runStore: SubagentRunStorePort | undefined;
  private readonly push: (message: HostPush) => void;
  /** Active runs keyed by runId. */
  private readonly activeRuns = new Map<string, ActiveRun>();

  constructor(options: SubagentOrchestratorOptions) {
    this.taskRunner = options.taskRunner;
    this.workspaceService = options.workspaceService;
    this.integrationPort = options.integrationPort;
    this.runStore = options.runStore;
    this.push = options.push;
  }

  /**
   * Run a batch of tasks with bounded concurrency. Returns the batch result
   * after all tasks settle. The caller may abort the batch via the returned
   * runId + `cancelBatch()`.
   */
  async runBatch(request: SubagentBatchRequest): Promise<SubagentBatchResult> {
    const issues = validateSubagentBatchRequest(request);
    if (issues.length > 0) {
      return {
        runId: 'invalid',
        status: 'failed',
        results: issues.map((issue) => ({
          runId: 'invalid',
          taskId: issue.taskId ?? 'unknown',
          executionStatus: 'failed' as const,
          summaryStatus: 'not-requested' as const,
          integrationStatus: 'not-requested' as const,
          error: issue.message,
        })),
      };
    }

    const runId = randomUUID();
    const abortController = new AbortController();
    const state = initSchedulerState(request);
    const activeRun: ActiveRun = { runId, abortController, state };
    this.activeRuns.set(runId, activeRun);

    await this.runStore?.createManifest(runId, request);

    const results = new Map<string, SubagentTaskResult>();
    const leases = new Map<string, SubagentWorkspaceLease>();

    try {
      while (!isBatchSettled(state) && !state.cancelled) {
        const ready = nextReadyBatch(state);
        if (ready.length === 0) {
          // No tasks ready — wait for running tasks to settle.
          // This is handled by the async dispatch below; break if nothing
          // is running (deadlock guard).
          let hasRunning = false;
          for (const status of state.status.values()) {
            if (status === 'running') {
              hasRunning = true;
              break;
            }
          }
          if (!hasRunning) break;
          // Yield to let running tasks progress.
          await new Promise((resolve) => setImmediate(resolve));
          continue;
        }

        // Dispatch ready tasks concurrently.
        const dispatches: Promise<void>[] = [];
        for (const taskId of ready) {
          const task = state.tasks.get(taskId)!;
          markTaskRunning(state, taskId);
          dispatches.push(this.dispatchTask(runId, task, state, results, leases, abortController.signal));
        }
        await Promise.all(dispatches);
      }
    } finally {
      // Release all leases.
      for (const lease of leases.values()) {
        await this.workspaceService.release(lease);
      }
    }

    const batchStatus = deriveBatchStatus(state);
    await this.runStore?.setStatus(runId, batchStatus);

    this.activeRuns.delete(runId);

    const result: SubagentBatchResult = {
      runId,
      status: batchStatus,
      results: request.tasks.map((t) =>
        results.get(t.id) ?? {
          runId,
          taskId: t.id,
          executionStatus: 'cancelled',
          summaryStatus: 'not-requested',
          integrationStatus: 'not-requested',
        },
      ),
    };

    this.push({
      type: 'subagent/batch-updated',
      runId,
      parentSessionId: request.parentSessionId,
      result,
    });

    return result;
  }

  /** Dispatch a single task: acquire workspace, run, settle, integrate. */
  private async dispatchTask(
    runId: string,
    task: SubagentTaskSpec,
    state: SchedulerState,
    results: Map<string, SubagentTaskResult>,
    leases: Map<string, SubagentWorkspaceLease>,
    signal: AbortSignal,
  ): Promise<void> {
    let lease: SubagentWorkspaceLease | undefined;
    try {
      lease = await this.workspaceService.acquire(task);
      leases.set(task.id, lease);

      const result = await this.taskRunner.start(task, lease, signal);
      results.set(task.id, result);
      await this.runStore?.recordResult(runId, task.id, result);

      // Integration for write tasks.
      if (
        result.executionStatus === 'completed' &&
        result.integrationStatus === 'pending' &&
        this.integrationPort
      ) {
        try {
          const integrated = await this.integrationPort.integrate(result);
          results.set(task.id, integrated);
          await this.runStore?.recordResult(runId, task.id, integrated);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const conflicted: SubagentTaskResult = {
            ...result,
            integrationStatus: 'conflict',
            error: message,
          };
          results.set(task.id, conflicted);
          await this.runStore?.recordResult(runId, task.id, conflicted);
        }
      }

      markTaskSettled(state, task.id, result.executionStatus === 'completed' ? 'completed' : result.executionStatus === 'cancelled' ? 'cancelled' : 'failed');

      this.push({
        type: 'subagent/task-updated',
        runId,
        parentSessionId: task.parentSessionId,
        result: results.get(task.id)!,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: SubagentTaskResult = {
        runId,
        taskId: task.id,
        executionStatus: 'failed',
        summaryStatus: 'not-requested',
        integrationStatus: 'not-requested',
        error: message,
        ...(lease?.worktreePath ? { worktreePath: lease.worktreePath } : {}),
      };
      results.set(task.id, failed);
      await this.runStore?.recordResult(runId, task.id, failed);
      markTaskSettled(state, task.id, 'failed');

      this.push({
        type: 'subagent/task-updated',
        runId,
        parentSessionId: task.parentSessionId,
        result: failed,
      });
    }
  }

  /** Cancel a running batch by runId. */
  async cancelBatch(runId: string): Promise<void> {
    const activeRun = this.activeRuns.get(runId);
    if (!activeRun) return;
    cancelAll(activeRun.state);
    activeRun.abortController.abort();
  }

  /** Check if a batch is still running. */
  isRunning(runId: string): boolean {
    return this.activeRuns.has(runId);
  }
}
