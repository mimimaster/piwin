/**
 * CE-SUB-ORCH: safe parallel subagent orchestration contracts.
 *
 * The orchestrator schedules tasks with bounded concurrency, delegates
 * execution to a backend, and tracks three orthogonal result axes
 * (execution, summary, integration). These contracts are consumed by the
 * scheduler, process backend, worktree integration, plan execution, the
 * model-facing tool, and Desktop — without exposing Pi-native shapes.
 */

import type { ModelRef, ThinkingLevel } from './host.js';
import type {
  SubagentExecutionStatus,
  SubagentIntegrationStatus,
  SubagentSummaryStatus,
} from './subagent-lifecycle.js';
import type { SubagentIsolationMode } from './subagent.js';

/** What to do when a task in a batch fails. */
export type SubagentFailurePolicy = 'continue' | 'fail-fast';

/** Whether process isolation is required or best-effort. */
export type SubagentProcessPolicy = 'required' | 'best-effort';

/** A workspace lease allocated by the workspace service. */
export type SubagentWorkspaceLease = {
  mode: SubagentIsolationMode;
  cwd: string;
  /** Base commit the worktree was created from (worktree mode only). */
  baseCommit?: string;
  /** Allocated worktree path (worktree mode only). */
  worktreePath?: string;
  /** Allocated worktree branch (worktree mode only). */
  worktreeBranch?: string;
};

/** A single task in a batch request. */
export type SubagentTaskSpec = {
  id: string;
  parentSessionId: string;
  task: string;
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  /** Task ids that must complete before this one can start. */
  dependsOn?: string[];
  /** Optional grouping key; tasks in the same group may be scheduled together. */
  parallelGroup?: string;
  /** Caller may make the profile stricter (worktree → readonly), never wider. */
  isolationOverride?: SubagentIsolationMode;
  allowedOutputPaths?: string[];
};

/** A batch of tasks to orchestrate. */
export type SubagentBatchRequest = {
  parentSessionId: string;
  tasks: SubagentTaskSpec[];
  maxConcurrency?: number;
  failurePolicy?: SubagentFailurePolicy;
  processPolicy?: SubagentProcessPolicy;
};

/** Per-task result after orchestration. */
export type SubagentTaskResult = {
  runId: string;
  taskId: string;
  childSessionId?: string;
  executionStatus: SubagentExecutionStatus;
  summaryStatus: SubagentSummaryStatus;
  integrationStatus: SubagentIntegrationStatus;
  profileId?: string;
  model?: ModelRef;
  summaryPreview?: string;
  changedFiles?: string[];
  verification?: string;
  error?: string;
  worktreePath?: string;
};

/** Batch-level result after all tasks settle. */
export type SubagentBatchResult = {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'needs-integration';
  results: SubagentTaskResult[];
};

/** A ready-to-run batch produced by the scheduler. */
export type SubagentReadyBatch = {
  /** Task ids that are ready to execute (dependencies satisfied). */
  taskIds: string[];
};

/** Validation issue for a batch request. */
export type SubagentBatchValidationIssue = {
  taskId?: string;
  message: string;
};

/**
 * Validate a batch request. Returns issues (never throws); the caller
 * decides whether to reject the batch. Checks for:
 * - empty tasks
 * - duplicate task ids
 * - unknown dependency ids
 * - self-dependencies
 * - negative maxConcurrency
 */
export function validateSubagentBatchRequest(
  request: SubagentBatchRequest,
): SubagentBatchValidationIssue[] {
  const issues: SubagentBatchValidationIssue[] = [];

  if (request.tasks.length === 0) {
    issues.push({ message: 'batch must contain at least one task' });
    return issues;
  }

  const ids = new Set<string>();
  for (const task of request.tasks) {
    if (!task.id.trim()) {
      issues.push({ message: 'task id is required' });
      continue;
    }
    if (ids.has(task.id)) {
      issues.push({ taskId: task.id, message: 'duplicate task id' });
    }
    ids.add(task.id);
  }

  for (const task of request.tasks) {
    if (!task.dependsOn) continue;
    for (const dep of task.dependsOn) {
      if (dep === task.id) {
        issues.push({ taskId: task.id, message: `self-dependency on "${dep}"` });
      } else if (!ids.has(dep)) {
        issues.push({
          taskId: task.id,
          message: `unknown dependency "${dep}"`,
        });
      }
    }
  }

  if (request.maxConcurrency !== undefined && request.maxConcurrency < 1) {
    issues.push({ message: 'maxConcurrency must be >= 1' });
  }

  return issues;
}
