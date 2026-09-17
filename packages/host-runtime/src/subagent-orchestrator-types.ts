import type {
  BackendPreparedPrompt,
  BackendSessionBlueprint,
  EphemeralProviderSecret,
  HostPush,
  ModelRef,
  PiwinConfig,
  SubagentBatchRequest,
  SubagentBatchResult,
  SubagentInvocation,
  SubagentProviderEnvelope,
  SubagentRuntimeSnapshot,
  SubagentTaskResult,
  SubagentTaskRunner,
  SubagentTaskSpec,
  SubagentWorkspaceLease,
} from '@piwin/contracts';
import type { RunRegistry } from './run-registry.js';
import type { RuntimeResourceCoordinator } from './runtime-resource-coordinator.js';
import type { SubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';

/** Backend seam: allocates workspace leases (readonly or worktree). */
export type SubagentWorkspaceService = {
  acquire(
    task: SubagentTaskSpec,
    options?: { signal?: AbortSignal },
  ): Promise<SubagentWorkspaceLease>;
  release(lease: SubagentWorkspaceLease): Promise<void>;
};

/** Optional durable run manifest store. */
export type SubagentRunStorePort = {
  createManifest(runId: string, request: SubagentBatchRequest): Promise<unknown>;
  loadManifest?: (runId: string) => Promise<
    | {
        status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration';
        results: Record<string, SubagentTaskResult>;
        parentSessionId: string;
        parentRunId?: string;
        tasks?: ReadonlyArray<{
          invocationId?: string;
          parentRunId?: string;
        }>;
        invocations?: Record<string, { id: string; parentRunId?: string }>;
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

/** Host-local owner facts for wait/cancel validation. */
export type SubagentBatchOwnerRecord = {
  runId: string;
  parentSessionId: string;
  parentRunId?: string;
  invocationIds: string[];
  active: boolean;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'needs-integration';
};

/** Synchronously returned batch identity plus durable acceptance and completion. */
export type SubagentBatchHandle = {
  runId: string;
  /** Resolves after durable manifest + queued invocation persistence. */
  accepted: Promise<void>;
  /** Synchronous predicate; true immediately after durable acceptance resolves. */
  hasAccepted: () => boolean;
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
    workspaceLease: SubagentWorkspaceLease;
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
  /** Freeze child S0/S1 after the executor stops and before integrate. */
  freezeChildResult?: (input: {
    result: SubagentTaskResult;
    lease: SubagentWorkspaceLease;
  }) => Promise<SubagentTaskResult>;
};
