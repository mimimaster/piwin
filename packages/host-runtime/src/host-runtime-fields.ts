import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  HostMode,
  HostResponse,
  JobController,
  McpConfigDocument,
  ModelRef,
  PermissionDecision,
  PermissionMode,
  SessionHandle,
  SessionSeedMessage,
  PushSink,
  RemoteSinkId,
} from '@piwin/contracts';
import { type ExtensionUiKind, type ExtensionUiResponse, AgentWorkerSupervisor } from '@piwin/agent-host';
import { createEventEnvelopeGenerator } from './host-event-envelope.js';
import { FetchCache } from '@piwin/tools-web';
import { type SessionColdStoragePlan, type SessionRuntimeRetentionConfig } from '@piwin/contracts';
import { HealthToolRunBudget } from './health-tool-run-budget.js';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { type McpGenerationSnapshot, type McpLifecycleManager } from '@piwin/mcp';
import { SessionTodoStore } from '@piwin/automation';
import { type PetStateStore } from './pet-state-store.js';

import { createSubagentRunStore } from '@piwin/session';
import type { ContextUsageSnapshot } from '@piwin/contracts';
import type { TranscriptRecorder } from './transcript-recorder.js';
import { type SessionTranscriptStoreRegistry } from './session-transcript-store-registry.js';
import { ProductAgentHost, type PreparedProductSession } from './product-agent-host.js';
import { createSessionStorageCoordinator } from './session-storage-coordinator.js';
import { SessionAllowlist } from './session-allowlist.js';
import { RunRegistry } from './run-registry.js';
import { PromptAdmissionGate } from './commands/session-prompt-admission.js';
import { QueuedTurnController } from './queued-turn-controller.js';
import { SessionRuntimeController } from './sessions/session-runtime-controller.js';
import { type SessionRuntimeResidencyController } from './sessions/session-runtime-residency-controller.js';
import { SessionRuntimeReplacementEngine } from './session-runtime-replacement.js';
import { WalkthroughGenerationRegistry } from './commands/walkthrough-commands.js';
import { createDoccardsIngestionRegistry } from './commands/doccards-job-commands.js';
import { createDoccardsGenerationRegistry } from './commands/doccards-generation-jobs.js';
import { RunEventCorrelator } from './run-event-correlator.js';
import { type SessionHostToolExecutionPort } from './tools/session-host-tool-port.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import { createSubagentWorkspaceService } from './subagent-workspace-service.js';
import { type SubagentIntegrationCoordinator } from './subagent-integration-coordinator.js';
import type { TurnChangeRuntime } from './turn-changes/runtime-wiring.js';
import { type RuntimeResourceCoordinator } from './runtime-resource-coordinator.js';
import { TurnScopedSchemeAdmissionGate } from './orchestration-scheme-admission.js';
import { SessionBodyGate } from './session-body-gate.js';
import { type PiwinRootLease } from './piwin-root-lease.js';
import type { SubagentTaskResult } from '@piwin/contracts';

import type { ComposedSessionHostTools, HostRuntimeOptions } from './host-runtime-types.js';
import type { SubscriptionAuthService } from './subscription-auth-service.js';
import type { LiveCallCoordinator } from './voice/live-call-coordinator.js';
import type { LiveSettingsService } from './voice/live-settings-service.js';
import type { SessionContextCoordinator } from './session-context-coordinator.js';

/** Mutable HostRuntime instance fields. HostRuntime remains the composition root. */
export class HostRuntimeFields {
  runtimeLeaseOwnerId = `host-${process.pid}-${randomUUID()}`;
  /** First claim time per session for runtime lease heartbeat continuity. */
  runtimeLeaseStartedAt = new Map<string, string>();
  rootLease: PiwinRootLease | null = null;
  hostInstanceId = '';
  host = undefined as unknown as ProductAgentHost;
  sessions = new Map<string, SessionHandle>();
  /**
   * ADR 0040 §2/§7: deduplicates concurrent cold-activation attempts per
   * session id so simultaneous prompts/resumes share one in-flight transition.
   */
  sessionActivationPromises = new Map<string, Promise<SessionHandle>>();
  /** Blocks runtime activation while durable archive/delete maintenance runs. */
  sessionMaintenanceSessions = new Set<string>();
  /** Complete suspension transactions, shared by eviction and prompt races. */
  sessionSuspensionPromises = new Map<string, Promise<boolean>>();
  /**
   * ADR 0040 §7: sessions whose fresh runtime generation still awaits its one
   * bounded product-history injection. Cleared after the first prompt of the
   * reconstructed generation injects history, so later turns never duplicate
   * it while the backend keeps native context.
   */
  coldStartHistoryBySession = new Map<string, string>();
  /**
   * Compact-only override for the next cold activation of a product session.
   * When set, `doActivateSessionRuntime` seeds the reconstructed backend from
   * product transcript instead of native copies / empty history.
   */
  pendingActivationSeedMessages = new Map<string, SessionSeedMessage[]>();
  sessionProjects = new Map<string, string>();
  /** Transient child context available before a child has a persisted session. */
  subagentSessionContexts = new Map<
    string,
    {
      parentSessionId: string;
      runtimeGenerationId: string;
      workingDirectory: string;
      parentRepoPath: string;
      invocationId?: string;
    }
  >();
  /** Model-facing merge seam cache, keyed by the child product session id. */
  subagentTaskResults = new Map<string, SubagentTaskResult>();
  /** ORCH: turn-scoped resolved scheme keyed by parent run id. */
  runOrchestrationSchemes = new Map<
    string,
    import('@piwin/contracts').ResolvedOrchestrationScheme
  >();
  /** ORCH: turn-scoped model-facing delegation policy. */
  runDelegationModes = new Map<string, 'auto' | 'disabled'>();
  /** Delegation surface frozen into each currently resident generation. */
  sessionRuntimeDelegationModes = new Map<string, 'auto' | 'disabled'>();
  /**
   * ORCH §8.4: turn-scoped concurrency / tasks-per-run gate for scheme-bound
   * parent runs. Bound when a scheme resolves; cleared on run terminate.
   */
  schemeAdmissionGate = new TurnScopedSchemeAdmissionGate();
  promptAdmissionGate = new PromptAdmissionGate();
  sessionBodyGate = new SessionBodyGate();
  /** Deduplicates concurrent cleanup callbacks for one crashed Run tree. */
  workerCrashCleanupRoots = new Set<string>();
  /** CE-OBS: last known usage snapshot per session. */
  sessionUsage = new Map<string, ContextUsageSnapshot>();
  /** CE-OBS: usage writes that must finish before a Host instance is disposed. */
  pendingUsageLedgerWrites = new Set<Promise<void>>();
  sessionContextCoordinator = undefined as unknown as SessionContextCoordinator;
  /** turn_end hooks already fired for a confirmed foreground runId. */
  turnEndHooksFired = new Set<string>();
  /** Last user prompt text for host-estimate usage (mock path). */
  sessionLastPromptText = new Map<string, string>();
  modelRequestOrdinals = new Map<string, number>();
  modelRequestOrdinalTails = new Map<string, Promise<void>>();
  /** CE-NAME: ModelRef used for the most recent prompt, for auto-naming. */
  sessionModels = new Map<string, ModelRef>();
  healthTurnBySession = new Map<string, { explicit: boolean }>();
  /** CE-NAME: latest assistant reply text per session (captured from events). */
  sessionLastAssistantReply = new Map<string, string>();
  /** CE-NAME: in-flight assistant text per messageId (text_delta accumulation). */
  assistantTextBuffers = new Map<string, string>();
  /** Runtime-only session override for auto-compaction (not persisted). */
  sessionAutoCompactionOverrides = new Map<string, boolean>();
  todoStore = new SessionTodoStore();
  /** CE-COMP: last files-touched block per session for prompt inject. */
  sessionFilesTouched = new Map<string, string>();
  /** SIDE: last injected side-chat context version per session (§7.5(5)). */
  sideChatSnapshotInjectedVersions = new Map<string, number>();
  pendingBranchCalibrationBySession = new Map<string, import('@piwin/contracts').WorkspaceWrites>();
  compactExportOperations = new Map<
    string,
    {
      sourceSessionId: string;
      temporarySession?: import('@piwin/contracts').SessionHandle;
      abortRequested: boolean;
    }
  >();
  /** Structured lifecycle authority for every foreground and descendant Run. */
  runRegistry = undefined as unknown as RunRegistry;
  healthToolRunBudget = new HealthToolRunBudget();
  /** Host-owned normal next-turn and Replace Run authority. */
  queuedTurnController = undefined as unknown as QueuedTurnController;
  /** Preserves the run identity across asynchronous SDK event callbacks. */
  runExecutionContext = new AsyncLocalStorage<string>();
  runEventCorrelator = new RunEventCorrelator();
  /** §11.3: global in-flight walkthrough generation registry. */
  walkthroughRegistry = new WalkthroughGenerationRegistry((level, message) =>
    this.push({ type: 'host/log', level, message }),
  );
  doccardsIngestion = createDoccardsIngestionRegistry();
  doccardsGeneration = createDoccardsGenerationRegistry();
  petStateStore: PetStateStore | null = null;
  /** Guards first init of `petStateStore` so concurrent callers share one promise. */
  petStateStoreInit: Promise<PetStateStore> | null = null;
  /** C1: one ordered envelope stream per runtime session. */
  eventEnvelopeGenerators = new Map<string, ReturnType<typeof createEventEnvelopeGenerator>>();
  unsubscribers = new Map<string, () => void>();
  pendingPermissions = new Map<
    string,
    {
      resolve: (decision: PermissionDecision) => void;
      sessionId: string;
      runId?: string;
      projectPath?: string;
      action: string;
      detail: string;
      defaultDecision?: PermissionDecision;
      cleanup?: () => void;
    }
  >();
  /** ADR 0024 §4: per-session in-memory allowlists for "Allow for session". */
  sessionAllowlists = new Map<string, SessionAllowlist>();
  /** Per-session permission mode overrides set by agent mode (Plan/Ask). */
  sessionPermissionOverrides = new Map<string, PermissionMode>();
  /** Latest persisted permission mode; read dynamically by every admission gate. */
  permissionModeFromConfig: PermissionMode = 'auto';
  pendingExtensionUi = new Map<
    string,
    {
      resolve: (response: ExtensionUiResponse) => void;
      kind: ExtensionUiKind;
      sessionId: string;
    }
  >();
  transcriptRecorders = new Map<string, TranscriptRecorder>();
  transcriptStores = undefined as unknown as SessionTranscriptStoreRegistry;
  mcpManager: McpLifecycleManager | null = null;
  hostClosing = false;
  disposePromise: Promise<void> | null = null;
  jobController: JobController | null = null;
  /** Extracted web_fetch pages. Hits skip the network; admission still runs. */
  fetchCache = new FetchCache();
  cardStore: import('@piwin/flashcards').CardStore | null = null;
  studyService: import('@piwin/flashcards').StudyService | null = null;
  /** Envelope idempotency key for the in-flight Host command (study mutations). */
  commandRequestStore = new AsyncLocalStorage<{ idempotencyKey?: string }>();
  /** Host-owned browser session (ADR 0020); lazily created on first access. */
  browserSession: import('@piwin/browser').BrowserSession | null = null;
  /** Guards first init of `browserSession` so concurrent callers share one. */
  browserSessionInit: Promise<import('@piwin/browser').BrowserSession> | null = null;
  /** Unsubscribe for the browser session push wiring. */
  browserSessionUnsubscribe: (() => void) | null = null;
  folderRag: import('@piwin/doc-rag').FolderRag | null = null;
  folderRagKey: string | null = null;
  notesServices: {
    store: import('@piwin/notes').NoteStore;
    index: import('@piwin/notes').NoteIndex;
    searchOptions: import('@piwin/notes').SearchNotesOptions;
  } | null = null;
  /** Spec §12: per-session runtime generation/staleness registry. */
  runtimeController = undefined as unknown as SessionRuntimeController;
  /**
   * ADR 0040 §2: Host-owned residency state machine. Decides when runtimes may
   * be created or must be suspended; HostRuntime executes the real suspension
   * transaction through `suspendRuntime` and the blocker predicate.
   */
  residencyController = undefined as unknown as SessionRuntimeResidencyController;
  /** Direct creates hold an activating reservation until bind publishes them. */
  pendingDirectActivations = new Map<string, string>();
  runtimeReplacementEngine = undefined as unknown as SessionRuntimeReplacementEngine;
  extensionRevisionStore = undefined as unknown as ReturnType<typeof createExtensionRevisionStore>;
  extensionDeploymentIdsBySession = new Map<string, string>();
  extensionDeploymentPromisesById = new Map<string, Promise<HostResponse>>();
  /**
   * Startup terminalization of deployments left in-flight by a dead Host
   * process. `extensions/apply` awaits this before trusting persisted state.
   */
  extensionDeploymentStartupRecovery: Promise<void> | null = null;
  /** ADR 0040 §3: normalized retention policy (adaptive high water derived). */
  runtimeRetention = undefined as unknown as SessionRuntimeRetentionConfig;
  /** Effective automatic RSS high-water budget in MiB. */
  runtimeMemoryHighWaterMiB = 0;
  /** One-time persisted retention load before the first Host command. */
  runtimeRetentionInitialization: Promise<void> | null = null;
  /**
   * ADR 0040 §8: cached aggregate worker RSS sample. Refreshed with a short
   * throttle before admission; missing/stale samples mark completeness so no
   * false low-memory claim is made.
   */
  workerRssSample: {
    rssMiB: number;
    completeness: 'complete' | 'partial' | 'missing';
    sampledAtMs: number;
  } | null = null;
  /** Per-run denial counters for run-admission diagnostics (CE run admission). */
  runAdmissionDenials = new Map<string, number>();
  options = undefined as unknown as HostRuntimeOptions;
  /**
   * Parent-owned Host tool execution port for non-mock ProductAgentHost.
   * Mock mode leaves this null; capabilities.customTools follows the same flag.
   */
  sessionHostToolPort: SessionHostToolExecutionPort | null = null;
  /** Frozen Host tool surface per (sessionId, runtimeGenerationId). */
  generationToolSurfaces = new Map<string, Promise<ComposedSessionHostTools>>();
  /** MCP config snapshot paired with each frozen tool surface. */
  generationMcpConfigs = new Map<string, McpConfigDocument>();
  generationMcpSnapshots = new Map<string, McpGenerationSnapshot>();
  /** Permission-rule revision paired with each frozen tool surface. */
  generationPermissionRuleRevisions = new Map<string, string>();
  /** Candidate backend resources prepared before runtime commit. */
  preparedRuntimeGenerations = new Map<string, PreparedProductSession>();
  /** Retired active handles waiting for post-commit disposal. */
  retiredRuntimeSessions = new Map<string, SessionHandle>();
  /**
   * ADR 0027: push sinks. The legacy `onPush` option is registered under
   * the local sidecar sink id so existing single-sink callers keep working.
   * A future remote gateway connector attaches as an additional sink.
   */
  pushSinks = new Map<RemoteSinkId, PushSink>();
  /** ADR 0030: production subagent orchestrator (non-mock mode only). */
  subagentOrchestrator: SubagentOrchestrator | null = null;
  /** Durable subagent run manifest store (production non-mock mode). */
  subagentRunStore: ReturnType<typeof createSubagentRunStore> | null = null;
  /**
   * Ownership-fenced startup reconciliation. New subagent admission waits on
   * this promise so recovered state is visible before any batch starts.
   */
  subagentStartupRecovery: Promise<void> | null = null;
  /** Worker supervisor for isolated Pi child processes. */
  agentWorkerSupervisor: AgentWorkerSupervisor | null = null;
  /** Integration coordinator for worktree code integration. */
  subagentIntegrationCoordinator: SubagentIntegrationCoordinator | null = null;
  /** Turn-change store, coordinator, capture, and workspace write gate. */
  turnChangeRuntime: TurnChangeRuntime | null = null;
  /** In-process frozen subagent result registry and apply mutex. */
  subagentResultService: import('./subagent-result-service.js').SubagentResultService | null = null;
  /** Workspace service for subagent isolation leases. */
  subagentWorkspaceService: ReturnType<typeof createSubagentWorkspaceService> | null = null;
  /** Resource coordinator for bounded concurrency. */
  runtimeResourceCoordinator: RuntimeResourceCoordinator | null = null;
  sessionStorageCoordinator = createSessionStorageCoordinator();
  coldStoragePlans = new Map<string, SessionColdStoragePlan>();
  coldStorageRecovery: Promise<void> | null = null;
  ready = true;
  /** Host-owned Pi subscription OAuth (Codex / Grok / Copilot). */
  subscriptionAuth: SubscriptionAuthService | undefined;
  /** piwin Live singleton; created in initializeHostRuntime. */
  liveCallCoordinator: LiveCallCoordinator | null = null;
  liveSettings: LiveSettingsService | null = null;
  liveEnabledFromConfig = true;
  codexLiveAuthPresent = false;
  /** Remote Host-server sets this per command; local sidecar stays unset. */
  devicePrincipalStore = new AsyncLocalStorage<string>();

  // Overridden by HostRuntime. The walkthrough registry field initializer
  // binds `this.push` on the instance; JS resolves the subclass method.
  push(_message: import('@piwin/contracts').HostPush): void {}

  getMode(): HostMode {
    return this.host.mode;
  }

  getHostInstanceId(): string {
    return this.hostInstanceId;
  }
}
