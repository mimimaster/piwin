/**
 * CE-SUB-ORCH: safe parallel subagent orchestration contracts.
 *
 * Provider runtime envelope for worker sessions.
 *
 * The orchestrator freezes provider runtimes before dispatch so the worker
 * never resolves secrets itself (Phase 7 plan §6). This type is a minimal
 * contract-level mirror of the agent-host `SerializableProviderRuntime`; it
 * captures only the serializable shape needed to cross the package boundary.
 * The agent-host side casts to its own concrete type when calling the worker
 * protocol.
 */

/**
 * Minimal provider runtime envelope for cross-package transport.
 *
 * Contracts cannot import from agent-host, so this type mirrors the
 * `SerializableProviderRuntime` shape defined in agent-host's
 * `rpc/serializable-blueprint.ts`. The two types must stay structurally
 * compatible. When the worker task runner receives this envelope it casts
 * to the agent-host type before passing to the worker client.
 */
import type { EphemeralProviderSecret, WorkerProviderAuthDescriptor } from './provider-auth.js';
export type SubagentProviderEnvelope = {
  readonly providerId: string;
  readonly protocol?: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  readonly baseUrl?: string;
  readonly headers?: Record<string, string>;
  readonly models: ReadonlyArray<{
    readonly id: string;
    readonly label?: string;
    readonly input?: ReadonlyArray<'text' | 'image'>;
    readonly reasoning?: boolean;
    readonly contextWindow?: number;
    readonly maxOutputTokens?: number;
  }>;
  readonly auth: WorkerProviderAuthDescriptor;
};

/**
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
import type { SubagentDeliveryIntent, SubagentResultRef } from './subagent-delivery.js';
import type { SubagentApplyPolicy, SubagentIsolationMode } from './subagent.js';
import type { SubagentCapability, SubagentRuntimeSnapshot } from './subagent-profile.js';
import type { BackendPreparedPrompt } from './backend-prepared-prompt.js';
import type { BackendSessionBlueprint } from './backend-session-blueprint.js';
import type { SessionSeedMessage } from './session-seed.js';

/** What to do when a task in a batch fails. */
export type SubagentFailurePolicy = 'continue' | 'fail-fast';

/** A readonly workspace lease allocated by the workspace service. */
export type SubagentReadonlyWorkspaceLease = {
  readonly mode: 'readonly';
  readonly cwd: string;
  /** Parent repository path (the main worktree/repo root). */
  readonly parentRepoPath: string;
  /** Keeps legacy property reads narrowed to `undefined` for readonly leases. */
  readonly worktreePath?: never;
};

/** A worktree workspace lease allocated by the workspace service. */
export type SubagentWorktreeWorkspaceLease = {
  readonly mode: 'worktree';
  readonly cwd: string;
  /** Parent repository path (the main worktree/repo root). */
  readonly parentRepoPath: string;
  /** Allocated worktree path. */
  readonly worktreePath: string;
  /** Allocated worktree branch. */
  readonly worktreeBranch: string;
  /** Exact parent HEAD used as the worktree base. */
  readonly baseCommit: string;
};

/** A workspace lease allocated by the workspace service. */
export type SubagentWorkspaceLease =
  SubagentReadonlyWorkspaceLease | SubagentWorktreeWorkspaceLease;

/** A single task in a batch request. */
export type SubagentTaskSpec = {
  id: string;
  parentSessionId: string;
  task: string;
  /** Stable Host identity for one parent delegation invocation. */
  invocationId?: string;
  /** Parent Run that emitted the delegation tool call. */
  parentRunId?: string;
  /** Generation-normalized parent tool call used as the transcript anchor. */
  parentToolCallId?: string;
  /** Optional display name for the child session. */
  sessionName?: string;
  /**
   * Product call name (scheme roster role, e.g. scout). Distinct from
   * `profileId`, which is the capability recipe.
   */
  role?: string;
  profileId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  /** Task ids that must complete before this one can start. */
  dependsOn?: string[];
  /** Optional grouping key; tasks in the same group may be scheduled together. */
  parallelGroup?: string;
  /** Caller may make the profile stricter (worktree → readonly), never wider. */
  isolationOverride?: SubagentIsolationMode;
  /** Resolved application policy for worktree changes. */
  applyPolicy?: SubagentApplyPolicy;
  /** How the child result should be delivered to the parent workspace. */
  deliveryIntent?: SubagentDeliveryIntent;
  /** True when this spec was produced by a pre-delivery manual worktree action. */
  legacyManual?: boolean;
  /** Frozen result identity once a result record exists. */
  resultRef?: SubagentResultRef;
  /** Whether a worktree should be retained after successful execution. */
  retainWorktree?: boolean;
  /** Resolved capability ceiling captured before dispatch. */
  capabilities?: SubagentCapability[];
  /** Resolved skill allowlist captured before dispatch. */
  skillIds?: string[];
  allowedOutputPaths?: string[];
  /**
   * Optional scout return-format contract. Host prepends it to the child's
   * first prompt; continuations do not re-inject it.
   */
  reportContract?: string;
  /** Reuse an existing terminal child identity for a continuation Run. */
  continuationSessionId?: string;
  /** Host-validated existing workspace; continuation never allocates a new worktree. */
  continuationWorkspaceLease?: SubagentWorkspaceLease;
};

/** Durable parent-transcript projection for one delegation tool invocation. */
export type SubagentInvocationStatus =
  'queued' | 'starting' | 'running' | 'completed' | 'needs-integration' | 'failed' | 'cancelled';

/** Display-safe semantic activity retained across reconnect and Host restart. */
export type SubagentInvocationActivity =
  | { kind: 'queued' }
  | { kind: 'preparing' }
  | { kind: 'thinking' }
  | { kind: 'responding' }
  | { kind: 'tool'; toolName: string; title?: string }
  | { kind: 'permission'; action: string }
  | { kind: 'completed'; summary?: string }
  | { kind: 'needs-integration'; message?: string }
  | { kind: 'failed'; message?: string }
  | { kind: 'cancelled' };

export type SubagentInvocation = {
  id: string;
  parentSessionId: string;
  /** Batch Run that owns the task. */
  runId: string;
  /** Parent foreground Run that emitted the delegation tool. */
  parentRunId?: string;
  /** Generation-normalized tool id anchoring the inline parent block. */
  parentToolCallId?: string;
  taskId: string;
  task: string;
  title?: string;
  /** Scheme/product role when known (scout, reviewer, …). */
  role?: string;
  profileId?: string;
  model?: ModelRef;
  isolation?: SubagentIsolationMode;
  childSessionId?: string;
  status: SubagentInvocationStatus;
  activity: SubagentInvocationActivity;
  /** Monotonic within this invocation; consumers ignore stale revisions. */
  revision: number;
  createdAt: string;
  updatedAt: string;
};

/** Stable, redacted, display-safe failure projection for persisted results. */
export type SubagentFailureKind =
  | 'host-interrupted'
  | 'integration-conflict'
  | 'integration-failed'
  | 'validation'
  | 'provider'
  | 'internal'
  | 'cancelled';

/** Which lifecycle axis produced the failure. */
export type SubagentFailurePhase = 'execution' | 'integration' | 'cleanup';

/**
 * Structured failure attached to a task result. `code` is a stable
 * machine-readable identifier; `message` is bounded and redacted. The
 * human-readable `error` field remains for compatibility but must never be
 * the only durable representation.
 */
export type SubagentFailure = {
  kind: SubagentFailureKind;
  code: string;
  phase: SubagentFailurePhase;
  retryable: boolean;
  message: string;
};

/** A batch of tasks to orchestrate. */
export type SubagentBatchRequest = {
  parentSessionId: string;
  tasks: SubagentTaskSpec[];
  maxConcurrency?: number;
  failurePolicy?: SubagentFailurePolicy;
};

/** Absolute product safety ceiling; Settings may only lower this value. */
export const MAX_SUBAGENT_TASKS_PER_BATCH = 8 as const;

/** Per-task result after orchestration. */
export type SubagentTaskResult = {
  runId: string;
  taskId: string;
  childSessionId?: string;
  executionStatus: SubagentExecutionStatus;
  summaryStatus: SubagentSummaryStatus;
  integrationStatus: SubagentIntegrationStatus;
  role?: string;
  profileId?: string;
  model?: ModelRef;
  summaryPreview?: string;
  changedFiles?: string[];
  verification?: string;
  error?: string;
  /** Structured, redacted failure detail (present whenever a task failed). */
  failure?: SubagentFailure;
  worktreePath?: string;
  /** Relative paths that the integration operation is allowed to apply. */
  allowedOutputPaths?: string[];
};

/** Batch-level result after all tasks settle. */
export type SubagentBatchResult = {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'needs-integration';
  results: SubagentTaskResult[];
};

/**
 * Current batch projection returned by the status command.
 *
 * Active batches intentionally use a separate type from the terminal result
 * so consumers cannot accidentally treat a running batch as completed.
 */
export type SubagentBatchProjection = {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration' | 'unknown';
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

/** Capabilities reported by the task runner backend. */
export type SubagentTaskRunnerCapabilities = {
  /** True when the backend runs tasks in isolated worker processes. */
  processIsolation: boolean;
};

/** Frozen input for a task run — the runner does not re-read Settings or profiles. */
export type SubagentTaskRunInput = {
  taskRunId: string;
  parentSessionId: string;
  childSessionId: string;
  runtimeGenerationId: string;
  task: SubagentTaskSpec;
  runtimeSnapshot: SubagentRuntimeSnapshot;
  workspaceLease: SubagentWorkspaceLease;
  /** JSON-safe compiled blueprint — frozen before backend dispatch. */
  sessionBlueprint: BackendSessionBlueprint;
  /** Prepared prompt text and images — frozen before dispatch. */
  preparedPrompt: BackendPreparedPrompt;
  /** Bounded product transcript used to reconstruct a continuation worker. */
  seedMessages?: readonly SessionSeedMessage[];
  /** In-memory secret material for the worker's one-shot bootstrap channel. */
  providerSecrets?: readonly EphemeralProviderSecret[];
  /**
   * Provider runtime envelope — frozen before backend dispatch.
   *
   * The worker must not resolve secrets itself (Phase 7 plan §6). The
   * orchestrator compiles the provider runtimes and passes them through
   * so the worker can construct model clients without reading settings.
   * A provider-backed task requires at least one entry; `providers: []`
   * is forbidden for tasks that need model access.
   */
  providers?: SubagentProviderEnvelope[];
};

/** Output from a task run. */
export type SubagentTaskRunOutput = {
  executionStatus: SubagentExecutionStatus;
  summaryStatus: SubagentSummaryStatus;
  integrationStatus: SubagentIntegrationStatus;
  childSessionId?: string;
  summaryPreview?: string;
  changedFiles?: string[];
  verification?: string;
  error?: string;
};

/**
 * Backend seam: runs a single task in an isolated Pi session/process.
 *
 * The input is frozen before dispatch. The runner does not re-read Settings,
 * project trust, profiles, or prompt attachments.
 *
 * SC-06: Product concurrency above one requires `processIsolation=true`.
 * SC-07: Isolation is a backend fact; callers do not send a process-policy switch.
 */
export interface SubagentTaskRunner {
  readonly capabilities: SubagentTaskRunnerCapabilities;
  runTask(input: SubagentTaskRunInput, signal: AbortSignal): Promise<SubagentTaskRunOutput>;
}

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
  if (request.tasks.length > MAX_SUBAGENT_TASKS_PER_BATCH) {
    issues.push({
      message: `batch cannot contain more than ${MAX_SUBAGENT_TASKS_PER_BATCH} tasks`,
    });
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

  // Check for dependency cycles using DFS.
  const taskIds = new Set<string>();
  for (const task of request.tasks) {
    taskIds.add(task.id);
  }

  // Build adjacency list: task -> tasks it depends on.
  const adj = new Map<string, string[]>();
  for (const task of request.tasks) {
    adj.set(task.id, task.dependsOn ?? []);
  }

  // DFS-based cycle detection (WHITE→GRAY→BLACK coloring).
  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const id of taskIds) {
    color.set(id, WHITE);
  }

  function hasCycle(id: string): boolean {
    const c = color.get(id);
    if (c === GRAY) return true; // back edge → cycle
    if (c === BLACK) return false; // already processed
    color.set(id, GRAY);
    const deps = adj.get(id) ?? [];
    for (const dep of deps) {
      if (taskIds.has(dep) && hasCycle(dep)) return true;
    }
    color.set(id, BLACK);
    return false;
  }

  for (const id of taskIds) {
    if (color.get(id) === WHITE) {
      if (hasCycle(id)) {
        issues.push({ message: 'dependency cycle detected in task graph' });
        break;
      }
    }
  }

  if (request.maxConcurrency !== undefined && request.maxConcurrency < 1) {
    issues.push({ message: 'maxConcurrency must be >= 1' });
  }

  return issues;
}
