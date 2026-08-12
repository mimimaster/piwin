import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
import { totalmem } from 'node:os';
import type {
  AgentEvent,
  AgentHost,
  CreateSessionInput,
  CreateSessionOptions,
  HostCommand,
  HostMode,
  HostPush,
  HostResponse,
  HostStatusData,
  HostToolRegistration,
  JobController,
  MediaAttachmentRef,
  McpConfigDocument,
  MediaSaveData,
  ModelRef,
  PermissionDecision,
  PermissionMode,
  PromptAttachment,
  PromptInput,
  SessionHandle,
  AgentEventEnvelope,
  PushSink,
  RemoteSinkId,
  RunTerminalCode,
} from '@piwin/contracts';
import {
  createEventEnvelopeGenerator,
  estimateMockUsage,
  type ExtensionUiKind,
  type ExtensionUiResponse,
  AgentWorkerSupervisor,
  WorkerTaskRunner,
} from '@piwin/agent-host';
import {
  contentKindForMimeType,
  deriveMemoryHighWaterMiB,
  deriveMemoryLowWaterMiB,
  formatError,
  isRunTerminal,
  LEGACY_LOCAL_SINK_ID,
  normalizeSessionRuntimeRetentionConfig,
  shouldAcceptContextUsage,
  USER_AUTHORED_GENERATION,
  type SessionRuntimeRetentionConfig,
} from '@piwin/contracts';
import { formatTextModelWebElementInjection } from '@piwin/contracts';
import {
  assertInsideMediaRoot,
  createMediaService,
  extractAttachmentText,
  formatAttachmentTextInjection,
} from '@piwin/media';
import {
  formatVisionDescriptionInjection,
  pathInjectMediaAttachment,
  primaryModelSupportsImage,
  resolvePrimaryModelInput,
  shouldDelegateVision,
  splitAttachments,
  VisionDelegationCache,
  sharedVisionDelegationCache,
  delegateImageToVisionModel,
  DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT,
} from './vision-delegation.js';
import { ensureBundledSkillsInstalled, scanSkills } from '@piwin/skills';
import { enrichAgentEventDocumentTargets } from './document-targets.js';
import { installSkill, installExtension } from '@piwin/marketplace';
import { scanExtensions } from './extension-scanner.js';
import { ensureBundledExtensionsInstalled } from './ensure-bundled-extensions.js';
import { scanPrompts } from './prompt-scanner.js';
import { ensureBundledPromptsInstalled } from './ensure-bundled-prompts.js';
import {
  createMcpLifecycleManager,
  getMcpConfigPath,
  listEnabledServers,
  loadMcpConfig,
  saveMcpConfig,
  tryValidateMcpConfig,
  createMcpGenerationSnapshot,
  type McpGenerationSnapshot,
  type McpLifecycleManager,
} from '@piwin/mcp';
import { createFileRecordStore, createJobRegistry, type JobRegistryEvent } from '@piwin/process';
import {
  createGitService,
  removeWorktree,
  integrateWorktreeChanges,
  isWorktreeBaseClean,
} from '@piwin/git';
import {
  deleteCronJob,
  getCronStorePath,
  getHooksStorePath,
  isCronDue,
  loadCronJobs,
  loadHooks,
  runMatchingHooks,
  SessionTodoStore,
  setHooks,
  upsertCronJob,
} from '@piwin/automation';
import {
  listMcpRegistryCards,
  listSkillStoreEntries,
  draftToServerConfig,
} from '@piwin/marketplace';
import { extractFileOpsFromUnknown, formatFilesTouchedBlock } from './compaction-file-ops.js';
import {
  getActiveTheme,
  installThemeFromLocalPath,
  listThemes,
  setActiveTheme,
} from '@piwin/theme';
import {
  getActivePet,
  installPetFromLocalPath,
  installPetFromRegistry,
  listPets,
  queryRemotePetStore,
  setActivePet,
} from '@piwin/pet';
import { createPetStateStore, type PetStateStore } from './pet-state-store.js';
import type { PetRuntimeSnapshot } from '@piwin/contracts';
import {
  addBashAllowRule,
  addFileWriteAllowRule,
  allowNetworkFetchHost,
  allowNetworkWebSearch,
  listProjects,
  openOrCreateProject,
  setProjectTrust,
} from '@piwin/project';

import {
  createSessionRecord,
  deriveDefaultNameFromMessage,
  isPlaceholderSessionName,
  getSessionRecord,
  setSessionAutoName,
  upsertSessionRecord,
  buildSessionOutline,
  loadSessionPlan,
  saveSessionPlan,
  clearSessionPlan,
  validateSessionPlan,
  listChildSessions,
  applyPlanStepUpdate,
  applyPlanStatus,
  mergeProductHistoryIntoPrompt,
  suggestSessionExportBasename,
  appendUsageRecord,
  readLatestSessionContextUsage,
  createSubagentRunStore,
  type SessionTranscriptStore,
} from '@piwin/session';
import type {
  ContextUsageSnapshot,
  SessionPlan,
  SessionResumeData,
  SessionTranscriptMessage,
  UsageRecord,
} from '@piwin/contracts';
import type { TranscriptRecorder } from './transcript-recorder.js';
import { createStoreTranscriptRecorder } from './store-transcript-recorder.js';
import {
  createSessionTranscriptStoreRegistry,
  type SessionTranscriptStoreRegistry,
} from './session-transcript-store-registry.js';
import { createDelayedSessionHandle } from './delayed-session-fixture.js';
import { createProductShellSession } from './product-shell-session.js';
import { formatPlanForModelContext } from './format-plan-context.js';
import {
  ProductAgentHost,
  createProductSessionId,
  createRuntimeGenerationId,
  type PreparedProductSession,
  type ProductAgentHostToolRegistrationMode,
} from './product-agent-host.js';
import { loadPiwinConfig, savePiwinConfig } from './config-store.js';
import { maybeAutoNameSession } from './session-naming-service.js';
import { createSecretResolver } from './secret-resolver.js';
import { findEnabledProvider, getEnabledProviders } from './provider-helpers.js';
import {
  getPiwinMediaDir,
  getPiwinGeneralWorkspacePath,
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionPlanPath,
  getPiwinSessionDir,
  getPiwinUsageLedgerPath,
} from './paths.js';
import { buildPermissionRequestContext } from './permission-context.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { computePermissionRulesRevision } from './permission-rule-revision.js';
import { loadMergedPermissionRules } from './permission-rule-loader.js';
import { SessionAllowlist } from './session-allowlist.js';
import { fail, ok } from './response-helpers.js';
import { indexRecordToSummary } from './session-summary-map.js';
import { RunRegistry } from './run-registry.js';
import { dispatchDomainCommands } from './commands/domain-command-dispatch.js';
import {
  handleSessionLiveCommand,
  type SessionLiveContext,
} from './commands/session-live-commands.js';
import type { HostCommandContext } from './commands/host-command-context.js';
import { SessionRuntimeController } from './sessions/session-runtime-controller.js';
import {
  createSessionRuntimeResidencyController,
  type SessionRuntimeResidencyController,
} from './sessions/session-runtime-residency-controller.js';
import { createImmediateSafetyPredicate } from './sessions/immediate-safety-gate.js';
import {
  SessionRuntimeReplacementEngine,
  type RuntimeReplacementCandidate,
} from './session-runtime-replacement.js';
import {
  handleWalkthroughCancel,
  WalkthroughGenerationRegistry,
  type WalkthroughCommandContext,
} from './commands/walkthrough-commands.js';
import { RunEventCorrelator } from './run-event-correlator.js';
import {
  createSessionHostToolExecutionPort,
  type SessionHostToolExecutionPort,
} from './tools/session-host-tool-port.js';
import { buildSessionHostTools, descriptorsFromTools } from './tools/build-session-host-tools.js';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
import { createHostToolPermissionGate } from './tools/host-tool-admission-gate.js';
import { toolFamilyIndex } from './tools/tool-family-index.js';
import { SubagentOrchestrator } from './subagent-orchestrator.js';
import type {
  SubagentOrchestratorOptions,
  SubagentTaskPreparationInput,
  PreparedSubagentTask,
} from './subagent-orchestrator.js';
import { planSubagentSpawn } from './subagent-lifecycle-service.js';
import { createSubagentWorkspaceService } from './subagent-workspace-service.js';
import {
  createSubagentIntegrationCoordinator,
  createGitWorktreeIntegrationAdapter,
  type SubagentIntegrationCoordinator,
} from './subagent-integration-coordinator.js';
import {
  createRuntimeResourceCoordinator,
  type RuntimeResourceCoordinator,
} from './runtime-resource-coordinator.js';
import { TurnScopedSchemeAdmissionGate } from './orchestration-scheme-admission.js';
import { compileBlueprintForWorker } from './blueprint-compiler.js';
import type { SubagentRunSeam } from './subagent-run-tool.js';
import type {
  SubagentRuntimeSnapshot,
  BackendSessionBlueprint,
  BackendPreparedPrompt,
  SubagentBatchRequest,
  SubagentBatchResult,
  SubagentTaskSpec,
  SubagentTaskResult,
  SubagentWorkspaceLease,
} from '@piwin/contracts';

const TRANSCRIPT_STORE_LEASED_COMMANDS = new Set<HostCommand['type']>([
  'session/resume',
  'session/pause',
  'session/resume-run',
  'session/outline-page',
  'session/user-message-index',
  'session/transcript-page',
  'session/transcript-window',
  'session/messages',
  'session/export',
  'session/truncate-from',
  'session/duplicate',
  'session/fork',
  'walkthrough/list',
  'walkthrough/generate',
]);

export type HostRuntimeOptions = {
  mode: HostMode;
  mock?: boolean;
  piwinRoot?: string;
  rpcCommand?: string;
  /** Explicit internal worker artifact for source-mode diagnostics/soak. */
  agentWorkerScript?: string;
  onPush?: (message: HostPush) => void;
  /**
   * Explicit test seam used only by the JSONL integration harness. Production
   * callers omit it and always create sessions through the Pi adapter.
   */
  testFixture?: HostRuntimeTestFixture;
  /**
   * Session-level permission mode override (ADR 0019 §3). Takes precedence
   * over `config.permissions.mode` without persisting to disk.
   */
  permissionModeOverride?: PermissionMode;
};

export type HostRuntimeTestFixture =
  'hang-until-abort' | 'slow-first-token' | 'high-rate-tool-output';

type SessionLineage = {
  parentSessionId?: string;
  kind?: 'main' | 'subagent' | 'side-chat';
  depth?: number;
  subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
  task?: string;
  subagentMode?: 'readonly' | 'worktree';
  subagentApplyPolicy?: 'none' | 'auto' | 'explicit';
  subagentAllowedOutputPaths?: string[];
  subagentRetainWorktree?: boolean;
  subagentRole?: string;
  worktreePath?: string;
  worktreeBranch?: string;
  /** CE-SUB-PROF: immutable runtime snapshot (source of truth for resume). */
  subagentRuntime?: import('@piwin/contracts').SubagentRuntimeSnapshot;
  /** CE-SUB-LIFE: orthogonal execution/summary/integration state axes. */
  subagentLifecycle?: import('@piwin/contracts').SubagentLifecycleState;
};

type ComposedSessionHostTools = {
  tools: HostToolRegistration[];
  permissionGate: import('./tools/host-tool-execution-router.js').HostToolPermissionGate;
  mcpCapabilityBrief: McpCapabilityBrief;
};

export class HostRuntime {
  private readonly host: ProductAgentHost;
  private readonly sessions = new Map<string, SessionHandle>();
  /**
   * ADR 0040 §2/§7: deduplicates concurrent cold-activation attempts per
   * session id so simultaneous prompts/resumes share one in-flight transition.
   */
  private readonly sessionActivationPromises = new Map<string, Promise<SessionHandle>>();
  /** Complete suspension transactions, shared by eviction and prompt races. */
  private readonly sessionSuspensionPromises = new Map<string, Promise<boolean>>();
  /**
   * ADR 0040 §7: sessions whose fresh runtime generation still awaits its one
   * bounded product-history injection. Cleared after the first prompt of the
   * reconstructed generation injects history, so later turns never duplicate
   * it while the backend keeps native context.
   */
  private readonly coldStartHistoryBySession = new Map<string, string>();
  private readonly sessionProjects = new Map<string, string>();
  /** Transient child context available before a child has a persisted session. */
  private readonly subagentSessionContexts = new Map<
    string,
    {
      parentSessionId: string;
      runtimeGenerationId: string;
      workingDirectory: string;
      parentRepoPath: string;
    }
  >();
  /** Model-facing merge seam cache, keyed by the child product session id. */
  private readonly subagentTaskResults = new Map<string, SubagentTaskResult>();
  /** ORCH: turn-scoped resolved scheme keyed by parent run id. */
  private readonly runOrchestrationSchemes = new Map<
    string,
    import('@piwin/contracts').ResolvedOrchestrationScheme
  >();
  /**
   * ORCH §8.4: turn-scoped concurrency / tasks-per-run gate for scheme-bound
   * parent runs. Bound when a scheme resolves; cleared on run terminate.
   */
  private readonly schemeAdmissionGate = new TurnScopedSchemeAdmissionGate();
  /** Deduplicates concurrent cleanup callbacks for one crashed Run tree. */
  private readonly workerCrashCleanupRoots = new Set<string>();
  /** CE-OBS: last known usage snapshot per session. */
  private readonly sessionUsage = new Map<string, ContextUsageSnapshot>();
  /** Last user prompt text for host-estimate usage (mock path). */
  private readonly sessionLastPromptText = new Map<string, string>();
  /** CE-NAME: ModelRef used for the most recent prompt, for auto-naming. */
  private readonly sessionModels = new Map<string, ModelRef>();
  /** CE-NAME: latest assistant reply text per session (captured from events). */
  private readonly sessionLastAssistantReply = new Map<string, string>();
  /** CE-NAME: in-flight assistant text per messageId (text_delta accumulation). */
  private readonly assistantTextBuffers = new Map<string, string>();
  /** Runtime-only session override for auto-compaction (not persisted). */
  private readonly sessionAutoCompactionOverrides = new Map<string, boolean>();
  private readonly todoStore = new SessionTodoStore();
  /** CE-COMP: last files-touched block per session for prompt inject. */
  private readonly sessionFilesTouched = new Map<string, string>();
  /** SIDE: last injected side-chat context version per session (§7.5(5)). */
  private readonly sideChatSnapshotInjectedVersions = new Map<string, number>();
  /** Structured lifecycle authority for every foreground and descendant Run. */
  private readonly runRegistry: RunRegistry;
  /** Preserves the run identity across asynchronous SDK event callbacks. */
  private readonly runExecutionContext = new AsyncLocalStorage<string>();
  private readonly runEventCorrelator = new RunEventCorrelator();
  /** §11.3: global in-flight walkthrough generation registry. */
  private readonly walkthroughRegistry = new WalkthroughGenerationRegistry((level, message) =>
    this.push({ type: 'host/log', level, message }),
  );
  private petStateStore: PetStateStore | null = null;
  /** Guards first init of `petStateStore` so concurrent callers share one promise. */
  private petStateStoreInit: Promise<PetStateStore> | null = null;
  /** C1: one ordered envelope stream per runtime session. */
  private readonly eventEnvelopeGenerators = new Map<
    string,
    ReturnType<typeof createEventEnvelopeGenerator>
  >();
  private readonly unsubscribers = new Map<string, () => void>();
  private readonly pendingPermissions = new Map<
    string,
    {
      resolve: (decision: PermissionDecision) => void;
      sessionId: string;
      runId?: string;
      projectPath?: string;
      action: string;
      detail: string;
      cleanup?: () => void;
    }
  >();
  /** ADR 0024 §4: per-session in-memory allowlists for "Allow for session". */
  private readonly sessionAllowlists = new Map<string, SessionAllowlist>();
  /** Per-session permission mode overrides set by agent mode (Plan/Ask). */
  private readonly sessionPermissionOverrides = new Map<string, PermissionMode>();
  /** Latest persisted permission mode; read dynamically by every admission gate. */
  private permissionModeFromConfig: PermissionMode = 'auto';
  private readonly pendingExtensionUi = new Map<
    string,
    {
      resolve: (response: ExtensionUiResponse) => void;
      kind: ExtensionUiKind;
      sessionId: string;
    }
  >();
  private readonly transcriptRecorders = new Map<string, TranscriptRecorder>();
  private readonly transcriptStores: SessionTranscriptStoreRegistry;
  private mcpManager: McpLifecycleManager | null = null;
  private hostClosing = false;
  private disposePromise: Promise<void> | null = null;
  private jobController: JobController | null = null;
  private cardStore: import('@piwin/flashcards').CardStore | null = null;
  /** Host-owned browser session (ADR 0020); lazily created on first access. */
  private browserSession: import('@piwin/browser').BrowserSession | null = null;
  /** Guards first init of `browserSession` so concurrent callers share one. */
  private browserSessionInit: Promise<import('@piwin/browser').BrowserSession> | null = null;
  /** Unsubscribe for the browser session push wiring. */
  private browserSessionUnsubscribe: (() => void) | null = null;
  private folderRag: import('@piwin/doc-rag').FolderRag | null = null;
  private notesServices: {
    store: import('@piwin/notes').NoteStore;
    index: import('@piwin/notes').NoteIndex;
    searchOptions: import('@piwin/notes').SearchNotesOptions;
  } | null = null;
  /** Spec §12: per-session runtime generation/staleness registry. */
  private readonly runtimeController: SessionRuntimeController;
  /**
   * ADR 0040 §2: Host-owned residency state machine. Decides when runtimes may
   * be created or must be suspended; HostRuntime executes the real suspension
   * transaction through `suspendRuntime` and the blocker predicate.
   */
  private readonly residencyController: SessionRuntimeResidencyController;
  /** Direct creates hold an activating reservation until bind publishes them. */
  private readonly pendingDirectActivations = new Map<string, string>();
  private readonly runtimeReplacementEngine: SessionRuntimeReplacementEngine;
  /** ADR 0040 §3: normalized retention policy (adaptive high water derived). */
  private runtimeRetention: SessionRuntimeRetentionConfig;
  /** Effective automatic RSS high-water budget in MiB. */
  private runtimeMemoryHighWaterMiB: number;
  /** One-time persisted retention load before the first Host command. */
  private runtimeRetentionInitialization: Promise<void> | null = null;
  /**
   * ADR 0040 §8: cached aggregate worker RSS sample. Refreshed with a short
   * throttle before admission; missing/stale samples mark completeness so no
   * false low-memory claim is made.
   */
  private workerRssSample: {
    rssMiB: number;
    completeness: 'complete' | 'partial' | 'missing';
    sampledAtMs: number;
  } | null = null;
  /** Per-run denial counters for run-admission diagnostics (CE run admission). */
  private readonly runAdmissionDenials = new Map<string, number>();
  private readonly options: HostRuntimeOptions;
  /**
   * Parent-owned Host tool execution port for non-mock ProductAgentHost.
   * Mock mode leaves this null; capabilities.customTools follows the same flag.
   */
  private readonly sessionHostToolPort: SessionHostToolExecutionPort | null;
  /** Frozen Host tool surface per (sessionId, runtimeGenerationId). */
  private readonly generationToolSurfaces = new Map<string, Promise<ComposedSessionHostTools>>();
  /** MCP config snapshot paired with each frozen tool surface. */
  private readonly generationMcpConfigs = new Map<string, McpConfigDocument>();
  private readonly generationMcpSnapshots = new Map<string, McpGenerationSnapshot>();
  /** Permission-rule revision paired with each frozen tool surface. */
  private readonly generationPermissionRuleRevisions = new Map<string, string>();
  /** Candidate backend resources prepared before runtime commit. */
  private readonly preparedRuntimeGenerations = new Map<string, PreparedProductSession>();
  /** Retired active handles waiting for post-commit disposal. */
  private readonly retiredRuntimeSessions = new Map<string, SessionHandle>();
  /**
   * ADR 0027: push sinks. The legacy `onPush` option is registered under
   * {@link LEGACY_LOCAL_SINK_ID} so existing single-sink callers keep working.
   * A future remote gateway connector attaches as an additional sink.
   */
  private readonly pushSinks = new Map<RemoteSinkId, PushSink>();
  /** ADR 0030: production subagent orchestrator (non-mock mode only). */
  private subagentOrchestrator: SubagentOrchestrator | null = null;
  /** Worker supervisor for isolated Pi child processes. */
  private agentWorkerSupervisor: AgentWorkerSupervisor | null = null;
  /** Integration coordinator for worktree code integration. */
  private subagentIntegrationCoordinator: SubagentIntegrationCoordinator | null = null;
  /** Workspace service for subagent isolation leases. */
  private subagentWorkspaceService: ReturnType<typeof createSubagentWorkspaceService> | null = null;
  /** Resource coordinator for bounded concurrency. */
  private runtimeResourceCoordinator: RuntimeResourceCoordinator | null = null;
  private ready = true;

  constructor(options: HostRuntimeOptions) {
    this.options = options;
    this.transcriptStores = createSessionTranscriptStoreRegistry({
      rootDir: getPiwinRoot(options.piwinRoot),
      onDiagnostic: (message) =>
        this.push({ type: 'host/log', level: 'info', message: `[transcript] ${message}` }),
    });
    if (options.onPush) {
      this.pushSinks.set(LEGACY_LOCAL_SINK_ID, {
        id: LEGACY_LOCAL_SINK_ID,
        push: options.onPush,
      });
    }
    this.runRegistry = new RunRegistry({
      onRunUpdated: (run) => this.push({ type: 'run/updated', run }),
      onRunTerminal: (run) => this.push({ type: 'run/terminal', run }),
    });
    this.runtimeController = new SessionRuntimeController({
      isRunInFlight: (sessionId) => {
        const generationId = this.runtimeController.getStatus(sessionId).generationId;
        return this.runRegistry
          .list({
            status: ['queued', 'running', 'cancelling'],
          })
          .some(
            (run) =>
              run.sessionId === sessionId ||
              (generationId !== undefined && run.runtimeGenerationId === generationId),
          );
      },
      onChanged: (status) => this.push({ type: 'session/runtime-updated', status }),
    });
    // ADR 0040 §2/§5/§6: the residency state machine decides when a runtime
    // may be created or must be suspended. HostRuntime owns the real cleanup
    // transaction (`suspendSessionRuntime`) and the blocker predicate that
    // keeps active/cancelling/permission/UI/compaction/replacement runtimes
    // resident. §3/§8: the adaptive RSS high water (25% of system memory,
    // clamped 512–2048 MiB) powers admission eviction; worker samples are
    // cached and marked incomplete when missing/stale.
    this.runtimeRetention = normalizeSessionRuntimeRetentionConfig(undefined);
    this.runtimeMemoryHighWaterMiB = deriveMemoryHighWaterMiB(totalmem() / 1024 / 1024);
    this.residencyController = createSessionRuntimeResidencyController({
      retention: {
        ...this.runtimeRetention,
        memoryHighWaterMiB: this.runtimeMemoryHighWaterMiB,
      },
      resolveMaxResidentRuntimes: () => {
        const executionConcurrency =
          this.runtimeResourceCoordinator?.getStatus().effectiveMaxConcurrency ?? 1;
        const adaptive = executionConcurrency + this.runtimeRetention.maxIdleRuntimes;
        const workerCapacity = this.agentWorkerSupervisor?.getStatus().maxActiveWorkers;
        return workerCapacity === undefined ? adaptive : Math.min(adaptive, workerCapacity);
      },
      isRuntimeProtected: (sessionId) => this.isSessionRuntimeProtected(sessionId),
      onResidencyChanged: (entry) => {
        this.runtimeController.setResidency(
          entry.sessionId,
          entry.state,
          entry.state === 'suspending' && entry.lastEvictionReason !== undefined
            ? { lastEvictionReason: entry.lastEvictionReason }
            : undefined,
        );
      },
      suspendRuntime: (input) => {
        return this.suspendSessionRuntime(input.sessionId, input.runtimeGenerationId, input.reason);
      },
      sampleMemory: () => {
        const hostRssMiB = Math.max(1, Math.round(process.memoryUsage().rss / 1024 / 1024));
        const worker = this.workerRssSample;
        if (!worker || worker.rssMiB <= 0) {
          return { hostRssMiB, sampleCompleteness: worker?.completeness ?? 'missing' };
        }
        return {
          hostRssMiB,
          workerRssMiB: worker.rssMiB,
          sampleCompleteness: worker.completeness,
        };
      },
    });
    this.runtimeReplacementEngine = new SessionRuntimeReplacementEngine({
      controller: this.runtimeController,
      getActiveGenerationId: (sessionId) =>
        this.runtimeController.getStatus(sessionId).generationId,
      getRunIds: (_sessionId, generationId) =>
        this.runRegistry
          .list({ status: ['queued', 'running', 'cancelling'] })
          .filter((run) => run.runtimeGenerationId === generationId)
          .map((run) => run.runId),
      waitForRuns: async (runIds) => {
        await Promise.all(runIds.map((runId) => this.runRegistry.join(runId)));
      },
      compileCandidate: (sessionId, generationId, settingsRevision) =>
        this.compileRuntimeCandidate(sessionId, generationId, settingsRevision),
      disposeGeneration: (sessionId, generationId) =>
        this.disposeRuntimeGeneration(sessionId, generationId),
      createGeneration: (sessionId, candidate) =>
        this.createRuntimeGeneration(sessionId, candidate),
      rollbackGeneration: (sessionId, generationId) =>
        this.rollbackRuntimeGeneration(sessionId, generationId),
      abortGeneration: (sessionId, generationId) =>
        this.abortRuntimeGeneration(sessionId, generationId),
      onCleanupError: ({ sessionId, generationId, error }) => {
        this.push({
          type: 'host/log',
          level: 'error',
          message: `runtime replacement cleanup failed for ${sessionId}/${generationId}: ${formatUnknownError(error)}`,
        });
      },
    });
    // Single process owner for Desktop UI lifecycle + SDK session tools.
    const rootDir = getPiwinRoot(options.piwinRoot);
    const mcpManager = createMcpLifecycleManager(rootDir);
    this.mcpManager = mcpManager;
    // CE-JOB: unified job controller — sole authority for non-interactive
    // OS child processes (ADR 0030 Phase B). No legacy compatibility layer.
    // ADR 0030: durable JobRecord persistence for host-start reconciliation.
    const jobRecordStore = createFileRecordStore(join(rootDir, 'jobs', 'records.json'));
    const jobController = createJobRegistry({
      recordStore: jobRecordStore,
      // Admission policy is derived from the persisted settings on every
      // start, so a settings tighten (maxProcesses / enabled) applies to new
      // Jobs immediately without killing already-running Jobs (ADR 0030 B1).
      getJobPolicy: async () => {
        try {
          const config = await loadPiwinConfig(this.options.piwinRoot);
          const processConfig = config.process;
          const maxActiveJobs =
            typeof processConfig?.maxProcesses === 'number' && processConfig.maxProcesses > 0
              ? processConfig.maxProcesses
              : 8;
          return {
            enabled: processConfig?.enabled !== false,
            maxActiveJobs,
          };
        } catch {
          // Unreadable settings must not silently block or permit Jobs; keep
          // the safe default (enabled with the registry default capacity).
          return { enabled: true, maxActiveJobs: 8 };
        }
      },
      getTrustedProjectRoots: async () => {
        try {
          const projects = await listProjects(getPiwinProjectsPath(rootDir));
          return projects
            .filter((project) => project.trust === 'trusted')
            .map((project) => project.path);
        } catch (error) {
          const detail = formatError(error);
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `trusted project roots read failed (jobs): ${detail}`,
          });
          return [];
        }
      },
      onEvent: (event: JobRegistryEvent) => this.emitJobEvent(event),
    });
    this.jobController = jobController;

    const commonHostOptions = {
      mode: options.mode,
      ...(options.piwinRoot ? { piwinRoot: options.piwinRoot } : {}),
      onGenerationCreated: (sessionId: string, generationId: string, settingsRevision: string) =>
        this.runtimeController.attachGeneration(sessionId, generationId, settingsRevision),
      onGenerationDetached: async (sessionId: string) => {
        this.runtimeController.detachGeneration(sessionId);
        this.sessionHostToolPort?.clearSession(sessionId);
        await this.releaseGenerationToolSurfaces(sessionId);
      },
      getMcpConfig: async (sessionId: string, runtimeGenerationId: string) =>
        this.getGenerationMcpConfig(sessionId, runtimeGenerationId),
      getMcpCapabilityBrief: async (sessionId: string, runtimeGenerationId: string) =>
        this.getGenerationMcpCapabilityBrief(sessionId, runtimeGenerationId),
      getPermissionRulesRevision: (sessionId: string, runtimeGenerationId: string) =>
        this.generationPermissionRuleRevisions.get(`${sessionId}\u0000${runtimeGenerationId}`),
      restrictToolSurface: (
        sessionId: string,
        runtimeGenerationId: string,
        toolNames: readonly string[],
      ) => {
        if (
          !this.sessionHostToolPort?.restrictGeneration(sessionId, runtimeGenerationId, toolNames)
        ) {
          throw new Error(
            `compiled Host tool surface is not registered: ${sessionId}/${runtimeGenerationId}`,
          );
        }
      },
      getCurrentRunId: () => this.runExecutionContext.getStore(),
    };
    if (options.mock === true) {
      this.sessionHostToolPort = null;
      this.host = new ProductAgentHost({ ...commonHostOptions, mock: true });
    } else {
      this.sessionHostToolPort = createSessionHostToolExecutionPort({
        isSessionKnown: (sessionId) =>
          this.runtimeController.hasActiveGeneration(sessionId) ||
          this.sessions.has(sessionId) ||
          this.subagentSessionContexts.has(sessionId),
        getRuntimeGenerationId: (sessionId) =>
          this.subagentSessionContexts.get(sessionId)?.runtimeGenerationId ??
          this.runtimeController.getStatus(sessionId).generationId,
        isRunAdmitted: (runId, sessionId, runtimeGenerationId) => {
          const run = this.runRegistry.get(runId);
          const admitted =
            run?.status === 'running' &&
            run.sessionId === sessionId &&
            run.runtimeGenerationId === runtimeGenerationId;
          if (!admitted) {
            // CE run-admission diagnostics: log WHY a tool frame was rejected.
            // The model sees only "run is not admitted for tool execution", so
            // the exact failure reason must be captured host-side.
            const denialKey = `${sessionId}\u0000${runId}`;
            const count = (this.runAdmissionDenials.get(denialKey) ?? 0) + 1;
            this.runAdmissionDenials.set(denialKey, count);
            const foreground = this.runRegistry.getForegroundRun(sessionId);
            const activeGeneration = this.runtimeController.getStatus(sessionId).generationId;
            let why: string;
            if (!run) {
              why = 'run-missing';
            } else if (run.status !== 'running') {
              why = `status=${run.status}`;
            } else if (run.sessionId !== sessionId) {
              why = `session-mismatch run=${run.sessionId} frame=${sessionId}`;
            } else {
              why = `generation-mismatch run=${run.runtimeGenerationId} frame=${runtimeGenerationId}`;
            }
            // First denial per (runId, sessionId) logs in full; repeats are
            // sampled at 1/10 to avoid flooding the host log during loops.
            if (count === 1 || count % 10 === 0) {
              this.push({
                type: 'host/log',
                level: 'warn',
                message:
                  `run admission denied (x${count}): runId=${runId} sessionId=${sessionId} ` +
                  `why=${why} frameGen=${runtimeGenerationId} ` +
                  `activeGen=${activeGeneration} foregroundRun=${foreground?.runId ?? '-'} ` +
                  `foregroundStatus=${foreground?.status ?? '-'}`,
              });
            }
          }
          return admitted;
        },
        // Repair spec WP2: the live safety predicate reads the controller's
        // pending tightening domains on every tool call, so a settings
        // tighten blocks new side effects immediately — before the candidate
        // generation finishes compiling. Child task sessions inherit the
        // parent's runtime generation and therefore read the parent's live
        // tightening state as well.
        isToolDisabled: createImmediateSafetyPredicate({
          getPendingDomains: (sessionId) => {
            const safetySessionId =
              this.subagentSessionContexts.get(sessionId)?.parentSessionId ?? sessionId;
            return this.runtimeController.getStatus(safetySessionId).staleDomains;
          },
        }),
      });
      this.agentWorkerSupervisor = this.createAgentWorkerSupervisor();
      this.host = new ProductAgentHost({
        ...commonHostOptions,
        mock: false,
        hostToolExecution: this.sessionHostToolPort,
        buildToolDescriptors: async (sessionId, runtimeGenerationId, model, mode = 'active') => {
          const tools = await this.buildSessionHostToolsForSession(
            sessionId,
            runtimeGenerationId,
            model,
            mode,
          );
          return descriptorsFromTools(tools);
        },
        buildToolFamilyIndex: async (sessionId, runtimeGenerationId, model, mode = 'active') => {
          const tools = await this.buildSessionHostToolsForSession(
            sessionId,
            runtimeGenerationId,
            model,
            mode,
          );
          return toolFamilyIndex(tools);
        },
        // Resolve trust from the project store so untrusted projects
        // cannot compile write/process/bash/delegate capabilities.
        trustResolver: async (projectPath: string) => {
          try {
            const rootDir = getPiwinRoot(this.options.piwinRoot);
            const projects = await listProjects(getPiwinProjectsPath(rootDir));
            const record = projects.find((p) => p.path === projectPath);
            return record?.trust === 'trusted';
          } catch {
            return false;
          }
        },
        workerSupervisor: this.agentWorkerSupervisor,
      });

      // ADR 0030 Phase D-3: compose the production SubagentOrchestrator.
      // Only non-mock mode gets real worker processes, workspace services,
      // and integration coordinators. Mock mode leaves the orchestrator null
      // and batch IPC returns a normalized not-ready response.
      this.composeSubagentOrchestrator();
    }
  }

  getMode(): HostMode {
    return this.host.mode;
  }

  async dispose(): Promise<void> {
    if (this.disposePromise) {
      return this.disposePromise;
    }
    this.hostClosing = true;
    this.disposePromise = this.disposeInternal();
    return this.disposePromise;
  }

  private async disposeInternal(): Promise<void> {
    const shutdownErrors: unknown[] = [];
    const replacementCleanup = this.runtimeReplacementEngine.cancelAll();
    const activeRuns = this.runRegistry.list({
      status: ['queued', 'running', 'cancelling'],
    });
    for (const run of activeRuns.filter((candidate) => candidate.parentRunId === undefined)) {
      this.runRegistry.cancelRun(run.runId);
    }
    const cleanedSessions = new Set<string>();
    for (const run of activeRuns) {
      if (cleanedSessions.has(run.sessionId)) continue;
      cleanedSessions.add(run.sessionId);
      let cleanupFailed = false;
      let cleanupMessage: string | undefined;
      const liveSession = this.sessions.get(run.sessionId);
      if (liveSession) {
        try {
          await liveSession.abort();
        } catch (error) {
          cleanupFailed = true;
          cleanupMessage = formatError(error);
        }
      }
      try {
        await this.stopProcessesForSession(run.sessionId);
      } catch (error) {
        cleanupFailed = true;
        cleanupMessage = formatError(error);
      }
      if (cleanupFailed) {
        this.push({
          type: 'host/log',
          level: 'warn',
          message: cleanupMessage ?? `run cleanup failed for ${run.runId}`,
        });
      }
    }
    for (const run of activeRuns) {
      this.runRegistry.terminate(run.runId, 'cancelled', 'host-shutdown', 'host disposed');
    }
    // Replacement cleanup must finish before MCP/Host disposal so a cancelled
    // candidate cannot recreate a generation against already-closed services.
    try {
      await replacementCleanup;
    } catch (error) {
      shutdownErrors.push(error);
    }
    for (const pendingPermission of this.pendingPermissions.values()) {
      pendingPermission.resolve('deny');
    }
    for (const pendingUiRequest of this.pendingExtensionUi.values()) {
      pendingUiRequest.resolve(createCancelledExtensionUiResponse(pendingUiRequest.kind));
    }
    this.pendingPermissions.clear();
    this.pendingExtensionUi.clear();
    if (this.notesServices) {
      try {
        this.notesServices.index.close();
      } catch {
        // best-effort shutdown
      }
      this.notesServices = null;
    }
    if (this.browserSessionUnsubscribe) {
      try {
        this.browserSessionUnsubscribe();
      } catch (error) {
        shutdownErrors.push(error);
      }
      this.browserSessionUnsubscribe = null;
    }
    if (this.browserSession) {
      try {
        await this.browserSession.close();
      } catch {
        // best-effort shutdown
      }
      this.browserSession = null;
      this.browserSessionInit = null;
    }
    if (this.jobController) {
      try {
        await this.jobController.dispose();
      } catch {
        // best-effort shutdown
      }
      this.jobController = null;
    }
    if (this.mcpManager) {
      try {
        await this.mcpManager.dispose();
      } catch {
        // best-effort shutdown
      }
      this.mcpManager = null;
    }
    for (const unsubscribe of this.unsubscribers.values()) {
      try {
        unsubscribe();
      } catch (error) {
        shutdownErrors.push(error);
      }
    }
    this.unsubscribers.clear();
    for (const sessionId of this.sessions.keys()) {
      this.runEventCorrelator.clear(sessionId);
      this.eventEnvelopeGenerators.delete(sessionId);
    }
    this.sessions.clear();
    this.sessionProjects.clear();
    try {
      await Promise.all([...this.transcriptRecorders.values()].map((recorder) => recorder.flush()));
    } catch (error) {
      shutdownErrors.push(error);
    } finally {
      for (const recorder of this.transcriptRecorders.values()) {
        try {
          recorder.dispose();
        } catch (error) {
          shutdownErrors.push(error);
        }
      }
      this.transcriptRecorders.clear();
      try {
        this.transcriptStores.closeAll();
      } catch (error) {
        shutdownErrors.push(error);
      }
    }
    // ADR 0030: dispose subagent orchestration components.
    if (this.subagentIntegrationCoordinator) {
      try {
        await this.subagentIntegrationCoordinator.dispose();
      } catch {
        // best-effort shutdown
      }
      this.subagentIntegrationCoordinator = null;
    }
    if (this.agentWorkerSupervisor) {
      try {
        await this.agentWorkerSupervisor.dispose();
      } catch {
        // best-effort shutdown
      }
      this.agentWorkerSupervisor = null;
    }
    this.subagentOrchestrator = null;
    this.subagentWorkspaceService = null;
    this.runtimeResourceCoordinator = null;
    try {
      await this.host.dispose();
    } catch (error) {
      shutdownErrors.push(error);
    }
    // ADR 0040: stop the residency sweep timer and reject pending waiters.
    this.residencyController.dispose();
    this.subagentSessionContexts.clear();
    this.generationToolSurfaces.clear();
    this.generationMcpConfigs.clear();
    this.generationMcpSnapshots.clear();
    this.generationPermissionRuleRevisions.clear();
    this.preparedRuntimeGenerations.clear();
    this.retiredRuntimeSessions.clear();
    this.sessionAllowlists.clear();
    this.sessionPermissionOverrides.clear();
    this.sessionUsage.clear();
    this.sessionLastPromptText.clear();
    this.sessionModels.clear();
    this.sessionLastAssistantReply.clear();
    this.assistantTextBuffers.clear();
    this.sessionAutoCompactionOverrides.clear();
    this.sessionFilesTouched.clear();
    this.subagentTaskResults.clear();
    this.workerCrashCleanupRoots.clear();
    this.eventEnvelopeGenerators.clear();
    this.sessionHostToolPort?.clear();
    this.pendingDirectActivations.clear();
    this.ready = false;
    if (shutdownErrors.length > 0) {
      throw new AggregateError(shutdownErrors, 'HostRuntime shutdown completed with errors');
    }
  }

  async handleCommand(command: HostCommand): Promise<HostResponse> {
    if (TRANSCRIPT_STORE_LEASED_COMMANDS.has(command.type)) {
      return this.transcriptStores.withCommandLease(
        () => this.handleCommandWithTranscriptLease(command),
        (sessionId) => this.sessions.has(sessionId) || this.transcriptRecorders.has(sessionId),
      );
    }
    return this.handleCommandWithTranscriptLease(command);
  }

  private async handleCommandWithTranscriptLease(command: HostCommand): Promise<HostResponse> {
    const requestId = typeof command.id === 'string' ? command.id : undefined;
    try {
      await this.ensureRuntimeRetentionLoaded();
      // §8.1: walkthrough/cancel is a control-channel request that must bypass
      // the normal long-task dispatch chain and abort the in-flight generation
      // immediately. Handle it before buildDomainCommands so it is never queued
      // behind a slow domain handler or a live session operation.
      if (command.type === 'walkthrough/cancel') {
        return handleWalkthroughCancel(
          command,
          requestId,
          this.buildWalkthroughContext(),
          this.walkthroughRegistry,
        );
      }
      const ctx = await this.buildDomainContext();
      const domain = await dispatchDomainCommands(command, requestId, ctx);
      if (domain) {
        // Spec §12.3/12.4: when Settings change, mark the affected live
        // sessions stale and keep safety gates tight without aborting the
        // current run. Only runtime-stale domains are recorded.
        if (command.type === 'settings/apply' && domain.type === 'response' && domain.success) {
          const data = domain.data as
            | { changedDomains?: { domain: import('@piwin/contracts').SettingsDomain }[] }
            | null
            | undefined;
          if (Array.isArray(data?.changedDomains)) {
            const changedDomains = data.changedDomains.map((item) => item.domain);
            const settingsConfig = (
              domain.data as {
                snapshot?: { config?: import('@piwin/contracts').PiwinConfig };
              }
            ).snapshot?.config;
            if (settingsConfig?.permissions?.mode) {
              this.permissionModeFromConfig = settingsConfig.permissions.mode;
            }
            if (settingsConfig?.session) {
              this.applyRuntimeRetention(settingsConfig.session.runtimeRetention);
            }
            for (const sessionId of this.sessions.keys()) {
              this.runtimeController.recordSettingsChange(sessionId, changedDomains);
            }
          }
        }
        return domain;
      }
      const sessionLive = await handleSessionLiveCommand(
        command,
        requestId,
        this.buildSessionLiveContext(),
      );
      if (sessionLive) {
        return sessionLive;
      }
      switch (command.type) {
        case 'host/ping':
          return ok(requestId, 'host/ping', { pong: true });
        case 'host/status':
          return ok(requestId, 'host/status', this.getStatus());
        case 'host/runtime-resources': {
          // Query-only aggregate metrics (ADR 0040 §8). Await the bounded
          // worker sample so a first query/Refresh click does not return the
          // previous cache and require a second poll for truthful diagnostics.
          await this.refreshWorkerRssSample();
          return ok(requestId, 'host/runtime-resources', this.getRuntimeResources());
        }

        default:
          return fail(requestId, 'unknown', 'Unhandled command');
      }
    } catch (error) {
      const message = formatError(error);
      return fail(requestId, command.type, message);
    }
  }

  /** Trust project explicitly after user confirms. */
  async trustProject(projectPath: string): Promise<unknown> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    return setProjectTrust(getPiwinProjectsPath(rootDir), projectPath, 'trusted');
  }

  /**
   * Emit a permission request to the UI and wait for permission/resolve.
   * Used by permission-aware tool registrations (web_search / web_fetch) during live sessions.
   */
  requestPermission(input: {
    sessionId: string;
    projectPath?: string;
    action: string;
    detail: string;
    defaultDecision: PermissionDecision;
    signal?: AbortSignal;
  }): Promise<PermissionDecision> {
    const requestId = randomUUID();
    const context = buildPermissionRequestContext(input.action, input.detail);
    return new Promise((resolve) => {
      const activeRun = this.runRegistry.getForegroundRun(input.sessionId);
      const executionRunId = this.runExecutionContext.getStore();
      const permissionRunId = executionRunId ?? activeRun?.runId;
      let settled = false;
      const cleanup = (): void => {
        input.signal?.removeEventListener('abort', abortHandler);
      };
      const settle = (decision: PermissionDecision): void => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this.pendingPermissions.delete(requestId);
        resolve(decision);
      };
      const abortHandler = (): void => {
        settle('deny');
      };
      const pendingPermission = {
        resolve: settle,
        sessionId: input.sessionId,
        ...(permissionRunId ? { runId: permissionRunId } : {}),
        ...(input.projectPath ? { projectPath: input.projectPath } : {}),
        action: input.action,
        detail: input.detail,
        cleanup,
      };
      this.pendingPermissions.set(requestId, pendingPermission);
      if (input.signal?.aborted) {
        settle('deny');
        return;
      }
      input.signal?.addEventListener('abort', abortHandler, { once: true });
      this.push({
        type: 'permission/request',
        sessionId: input.sessionId,
        requestId,
        action: input.action,
        detail: input.detail,
        defaultDecision: input.defaultDecision,
        context,
        ...(permissionRunId ? { runId: permissionRunId } : {}),
      });
      this.push({
        type: 'event',
        sessionId: input.sessionId,
        event: {
          type: 'permission/request',
          requestId,
          action: input.action,
          detail: input.detail,
          defaultDecision: input.defaultDecision,
          context,
          ...(permissionRunId ? { runId: permissionRunId } : {}),
        },
      });
    });
  }

  /**
   * Get or create the in-memory session allowlist (ADR 0024 §4).
   * Used by parent-owned bash/file registrations to check "Allow for session" approvals.
   */
  getOrCreateSessionAllowlist(sessionId: string): SessionAllowlist {
    let al = this.sessionAllowlists.get(sessionId);
    if (!al) {
      al = new SessionAllowlist();
      this.sessionAllowlists.set(sessionId, al);
    }
    return al;
  }

  /**
   * Record a session-scoped allow (ADR 0024 §4). Called when the user picks
   * "Allow for session" on a permission prompt. Extracts the command or path
   * from the permission detail.
   */
  rememberSessionPermission(sessionId: string, action: string, detail: string): void {
    const al = this.getOrCreateSessionAllowlist(sessionId);
    // Bash detail format: `<reason>: <command>` — the command is after `: `.
    // File-write detail is the resolved absolute path.
    if (action === 'bash') {
      const colonIdx = detail.indexOf(': ');
      const command = colonIdx >= 0 ? detail.slice(colonIdx + 2) : detail;
      al.addBashCommand(command);
    } else if (action === 'file-write') {
      al.addFilePath(detail);
    }
    // Network and other actions: no session remember (use project or once).
  }

  /** Clear the session allowlist when a session is disposed. */
  clearSessionAllowlist(sessionId: string): void {
    this.sessionAllowlists.delete(sessionId);
    this.sessionPermissionOverrides.delete(sessionId);
  }

  /** Set a per-session permission mode override (agent mode Plan/Ask floor). */
  setSessionPermissionOverride(sessionId: string, mode: PermissionMode): void {
    this.sessionPermissionOverrides.set(sessionId, mode);
  }

  /** Clear a per-session permission mode override. */
  clearSessionPermissionOverride(sessionId: string): void {
    this.sessionPermissionOverrides.delete(sessionId);
  }

  /** Get the per-session permission mode override, if any. */
  getSessionPermissionOverride(sessionId: string): PermissionMode | undefined {
    return this.sessionPermissionOverrides.get(sessionId);
  }

  waitForPermission(requestId: string): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      this.pendingPermissions.set(requestId, {
        resolve,
        sessionId: '',
        action: '',
        detail: '',
      });
    });
  }

  /**
   * Bridge Pi ExtensionUIContext confirm/select/input to Desktop (D-EXT-04).
   */
  requestExtensionUi(
    input: import('@piwin/agent-host').ExtensionUiRequest & { sessionId: string },
  ): Promise<import('@piwin/agent-host').ExtensionUiResponse> {
    return new Promise((resolve) => {
      this.pendingExtensionUi.set(input.requestId, {
        resolve,
        kind: input.kind,
        sessionId: input.sessionId,
      });
      const pushMessage: {
        type: 'extension/ui_request';
        sessionId: string;
        requestId: string;
        kind: import('@piwin/agent-host').ExtensionUiKind;
        title: string;
        message?: string;
        options?: string[];
        placeholder?: string;
      } = {
        type: 'extension/ui_request',
        sessionId: input.sessionId,
        requestId: input.requestId,
        kind: input.kind,
        title: input.title,
      };
      if (input.message !== undefined) {
        pushMessage.message = input.message;
      }
      if (input.options !== undefined) {
        pushMessage.options = input.options;
      }
      if (input.placeholder !== undefined) {
        pushMessage.placeholder = input.placeholder;
      }
      this.push(pushMessage);
    });
  }

  /**
   * Resolve every Extension UI wait owned by a session.
   *
   * Pi's Extension UI methods are promise-based and are not necessarily
   * connected to the foreground run AbortSignal. Stop therefore has to
   * explicitly settle these promises before aborting the live session.
   */
  private settlePendingExtensionUiForSession(sessionId: string): void {
    for (const [requestId, pending] of this.pendingExtensionUi.entries()) {
      if (pending.sessionId !== sessionId) {
        continue;
      }
      pending.resolve(createCancelledExtensionUiResponse(pending.kind));
      this.pendingExtensionUi.delete(requestId);
    }
  }

  private async rememberProjectPermission(
    sessionId: string,
    action: string,
    detail: string,
    scope: 'project' = 'project',
    pendingProjectPath?: string,
  ): Promise<void> {
    const projectPath = pendingProjectPath ?? this.sessionProjects.get(sessionId);
    // Empty path / general workspace path = no project allowlist to mutate.
    if (!projectPath || projectPath.trim().length === 0) {
      return;
    }
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const projectsFile = getPiwinProjectsPath(rootDir);

    if (action === 'bash' || action.startsWith('bash:')) {
      // Detail format from the parent-owned bash registration is `<reason>: <command>`. The command
      // is the remainder after the first `": "` separator, remembered verbatim
      // so an exact-match allowlist cannot be widened by prefix tricks.
      const commandString = extractBashCommandFromDetail(detail);
      if (commandString) {
        await addBashAllowRule(projectsFile, projectPath, commandString);
      }
      return;
    }

    if (action === 'file-write' || action.startsWith('file-write:')) {
      // Detail is the resolved absolute path approved by the user.
      const trimmed = detail.trim();
      if (trimmed) {
        await addFileWriteAllowRule(projectsFile, projectPath, trimmed);
      }
      return;
    }

    if (action.startsWith('network:')) {
      if (action === 'network:web_search') {
        await allowNetworkWebSearch(projectsFile, projectPath);
        return;
      }
      if (action === 'network:web_fetch') {
        try {
          const hostname = new URL(detail).hostname;
          await allowNetworkFetchHost(projectsFile, projectPath, hostname);
        } catch {
          // ignore invalid url detail
        }
      }
    }
  }

  /**
   * Sync path validation only (used before accepting a run).
   * Full model-facing rewrite is async — see {@link buildModelPromptInput}.
   */
  private validatePromptAttachments(input: PromptInput): void {
    if (!input.attachments || input.attachments.length === 0) {
      return;
    }
    const mediaRoot = getPiwinMediaDir(getPiwinRoot(this.options.piwinRoot));
    for (const attachment of input.attachments) {
      if (attachment.kind === 'media') {
        validateMediaAttachment(mediaRoot, attachment);
      } else if (attachment.screenshotPath !== undefined) {
        assertInsideMediaRoot(mediaRoot, attachment.screenshotPath);
      }
    }
  }

  /**
   * Attachments are accepted only from piwin's media root.
   *
   * Media branching (vision-delegation rev3):
   * - multimodal primary → keep media attachments → adapter loads ImageContent
   * - text-only + D1 on → vision description inject; strip media attachments
   * - text-only + D1 off → path inject; strip media attachments
   * Web-element: structured text injection always.
   */
  private async buildModelPromptInput(
    input: PromptInput,
    signal?: AbortSignal,
  ): Promise<PromptInput> {
    if (!input.attachments || input.attachments.length === 0) {
      // Shallow copy so preparePromptInput can rewrite model-facing text
      // (scheme / plan / history) without mutating the caller's PromptInput.
      return {
        ...input,
        text: input.text,
      };
    }

    const mediaRoot = getPiwinMediaDir(getPiwinRoot(this.options.piwinRoot));
    const safeAttachments: PromptAttachment[] = [];
    const webInjections: string[] = [];
    for (const attachment of input.attachments) {
      if (attachment.kind === 'media') {
        safeAttachments.push(validateMediaAttachment(mediaRoot, attachment));
      } else {
        if (attachment.screenshotPath !== undefined) {
          assertInsideMediaRoot(mediaRoot, attachment.screenshotPath);
        }
        safeAttachments.push(attachment);
        webInjections.push(formatTextModelWebElementInjection(attachment));
      }
    }

    const { media, other } = splitAttachments(safeAttachments);
    const imageMedia: MediaAttachmentRef[] = [];
    const extractedTextInjections: string[] = [];
    for (const mediaAttachment of media) {
      if (isTextualAttachment(mediaAttachment)) {
        if (signal?.aborted) {
          throw new Error('prompt preparation aborted');
        }
        const extracted = await extractAttachmentText(
          mediaAttachment.path,
          mediaAttachment.mimeType,
          mediaAttachment.name !== undefined ? { name: mediaAttachment.name } : undefined,
        );
        extractedTextInjections.push(formatAttachmentTextInjection(extracted));
      } else {
        imageMedia.push(mediaAttachment);
      }
    }
    const config = await loadPiwinConfig(this.options.piwinRoot);
    const primaryInput = resolvePrimaryModelInput(input, config);
    const supportsImage = primaryModelSupportsImage(primaryInput);
    const textInjections = [input.text, ...webInjections, ...extractedTextInjections].filter(
      Boolean,
    );

    if (imageMedia.length === 0) {
      return {
        ...input,
        text: textInjections.join('\n\n'),
        ...(other.length > 0 ? { attachments: other } : {}),
      };
    }

    if (supportsImage) {
      // D2: native images via adapter loadPromptImages. Native text stays
      // free of absolute paths/base64; the adapter encodes attachments as
      // ImageContent parts (spec Phase 4: "Remove native path inventory").
      this.push({
        type: 'host/log',
        level: 'info',
        message: `Sending ${imageMedia.length} image(s) as native vision content to the primary model`,
      });
      return {
        ...input,
        text: textInjections.join('\n\n'),
        attachments: [...other, ...imageMedia],
      };
    }

    // Text-only: never pass ImageContent to the primary model.
    const mediaInjections: string[] = [];
    const delegate =
      shouldDelegateVision({
        primaryModelInput: primaryInput,
        hasMediaAttachments: imageMedia.length > 0,
        config: config.visionDelegation,
      }) && config.visionDelegation?.model
        ? config.visionDelegation
        : undefined;

    if (delegate?.model) {
      const visionRef = delegate.model;
      const visionProvider = findEnabledProvider(config, visionRef.providerId);
      if (!visionProvider) {
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `vision delegation: provider not found (${visionRef.providerId}); falling back to path injection`,
        });
      } else {
        let apiKey: string | null = null;
        try {
          apiKey = await createSecretResolver().resolveProviderSecret(visionProvider);
        } catch (error) {
          const message = formatError(error);
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `vision delegation: secret resolve failed (${message}); path fallback`,
          });
        }
        if (apiKey) {
          const systemPrompt =
            delegate.systemPrompt?.trim() || DEFAULT_VISION_DELEGATION_SYSTEM_PROMPT;
          for (const mediaAttachment of imageMedia) {
            if (signal?.aborted) {
              throw new Error('prompt preparation aborted');
            }
            try {
              let description: string | undefined;
              const fileBytes = await readFile(mediaAttachment.path);
              const cacheKey =
                delegate.cacheEnabled === false
                  ? null
                  : VisionDelegationCache.buildKey({
                      fileBytes,
                      mimeType: mediaAttachment.mimeType,
                      providerId: visionRef.providerId,
                      modelId: visionRef.modelId,
                      systemPrompt,
                    });
              if (cacheKey) {
                description = sharedVisionDelegationCache.get(cacheKey);
              }
              if (!description) {
                this.push({
                  type: 'host/log',
                  level: 'info',
                  message: `Describing image with ${visionRef.providerId}/${visionRef.modelId}…`,
                });
                description = await delegateImageToVisionModel({
                  imagePath: mediaAttachment.path,
                  mimeType: mediaAttachment.mimeType,
                  provider: visionProvider,
                  modelId: visionRef.modelId,
                  apiKey,
                  systemPrompt,
                  ...(delegate.timeoutMs !== undefined ? { timeoutMs: delegate.timeoutMs } : {}),
                  ...(signal ? { signal } : {}),
                });
                if (cacheKey) {
                  sharedVisionDelegationCache.set(cacheKey, description);
                }
              }
              mediaInjections.push(
                formatVisionDescriptionInjection({
                  absolutePath: mediaAttachment.path,
                  mimeType: mediaAttachment.mimeType,
                  model: visionRef,
                  description,
                }),
              );
            } catch (error) {
              const message = formatError(error);
              this.push({
                type: 'host/log',
                level: 'warn',
                message: `vision delegation failed for ${mediaAttachment.path}: ${message}; path fallback`,
              });
              mediaInjections.push(pathInjectMediaAttachment(mediaAttachment));
            }
          }
          // Strip media so adapter does not load ImageContent for text-only primary.
          return stripMediaAttachments(
            input,
            [...textInjections, ...mediaInjections].filter(Boolean).join('\n\n'),
            other,
          );
        }
      }
    }

    // Path fallback (D1 off or vision provider/secret unavailable).
    this.push({
      type: 'host/log',
      level: 'warn',
      message:
        'Primary model is text-only (or vision input is unset). Images will be path-injected — the model cannot see pixels. Switch to a vision model or enable vision delegation.',
    });
    for (const mediaAttachment of imageMedia) {
      mediaInjections.push(pathInjectMediaAttachment(mediaAttachment));
    }
    return stripMediaAttachments(
      input,
      [...textInjections, ...mediaInjections].filter(Boolean).join('\n\n'),
      other,
    );
  }

  private async getNotesServices(): Promise<{
    store: import('@piwin/notes').NoteStore;
    index: import('@piwin/notes').NoteIndex;
    searchOptions: import('@piwin/notes').SearchNotesOptions;
  }> {
    if (!this.notesServices) {
      const rootDir = getPiwinRoot(this.options.piwinRoot);
      const config = await loadPiwinConfig(rootDir);
      if (config.notes?.enabled === false) {
        throw new Error('Notes are disabled (config.notes.enabled=false).');
      }
      const { createNoteStore, openNoteIndex, createEmbeddingProvider } =
        await import('@piwin/notes');
      const { resolveNotesEmbeddingApiKey } = await import('./notes-embedding-secret.js');
      const store = createNoteStore({ piwinRoot: rootDir });
      const index = await openNoteIndex(store);
      const searchOptions: import('@piwin/notes').SearchNotesOptions = {};
      if (config.notes?.embedding) {
        const apiKey = await resolveNotesEmbeddingApiKey(config.notes.embedding);
        const provider = createEmbeddingProvider({
          config: config.notes.embedding,
          ...(apiKey ? { apiKey } : {}),
        });
        if (provider) searchOptions.embeddingProvider = provider;
      }
      if (typeof config.notes?.search?.rrfK === 'number') {
        searchOptions.rrfK = config.notes.search.rrfK;
      }
      const { buildNotesRerankProvider } = await import('./notes-rerank.js');
      const rerank = await buildNotesRerankProvider(config);
      if (rerank) {
        searchOptions.rerankProvider = rerank;
      }
      this.notesServices = { store, index, searchOptions };
    }
    return this.notesServices;
  }

  private async getCardStore(): Promise<import('@piwin/flashcards').CardStore> {
    if (!this.cardStore) {
      const rootDir = getPiwinRoot(this.options.piwinRoot);
      const config = await loadPiwinConfig(rootDir);
      if (config.flashcards?.enabled === false) {
        throw new Error('Flashcards are disabled (config.flashcards.enabled=false).');
      }
      const { createCardStore } = await import('@piwin/flashcards');
      this.cardStore = createCardStore({ piwinRoot: rootDir });
    }
    return this.cardStore;
  }

  private async getFolderRag(): Promise<import('@piwin/doc-rag').FolderRag> {
    if (!this.folderRag) {
      const rootDir = getPiwinRoot(this.options.piwinRoot);
      const config = await loadPiwinConfig(rootDir);
      const { createFolderRag } = await import('@piwin/doc-rag');
      const { createEmbeddingProvider } = await import('@piwin/notes');
      const { resolveNotesEmbeddingApiKey } = await import('./notes-embedding-secret.js');
      let embeddingProvider: import('@piwin/contracts').EmbeddingProvider | undefined;
      if (config.notes?.embedding) {
        const apiKey = await resolveNotesEmbeddingApiKey(config.notes.embedding);
        const provider = createEmbeddingProvider({
          config: config.notes.embedding,
          ...(apiKey ? { apiKey } : {}),
        });
        if (provider) embeddingProvider = provider;
      }
      this.folderRag = createFolderRag({
        piwinRoot: rootDir,
        ...(embeddingProvider ? { embeddingProvider } : {}),
      });
    }
    return this.folderRag;
  }

  /**
   * Maps normalized AgentEvent → CE-HOOK events and runs matching hooks.
   * Failures are logged only; they never fail the original agent turn.
   */
  private async dispatchHooksForAgentEvent(sessionId: string, event: AgentEvent): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const config = await loadPiwinConfig(rootDir);
    if (config.automation?.enabled !== true || config.automation?.hooksEnabled !== true) {
      return;
    }
    let hookEvent: import('@piwin/contracts').HookEventName | null = null;
    let toolName: string | undefined;
    if (event.type === 'session/started') {
      hookEvent = 'agent_start';
    } else if (event.type === 'session/ended') {
      hookEvent = 'agent_end';
    } else if (event.type === 'message/start' && event.role === 'user') {
      hookEvent = 'turn_start';
    } else if (event.type === 'session/aborted' || event.type === 'usage/update') {
      // Abort or completed turn usage → turn_end (message/end has no role).
      hookEvent = 'turn_end';
    } else if (event.type === 'tool/end') {
      hookEvent = 'tool_execution_end';
    }
    if (!hookEvent) {
      return;
    }
    const hooksDocument = await loadHooks(getHooksStorePath(rootDir));
    if (hooksDocument.hooks.length === 0) {
      return;
    }
    const projectPath = this.sessionProjects.get(sessionId);
    const results = await runMatchingHooks(hooksDocument.hooks, {
      sessionId,
      event: hookEvent,
      ...(projectPath ? { projectPath } : {}),
      ...(toolName ? { toolName } : {}),
    });
    for (const result of results) {
      this.push({
        type: 'host/log',
        level: result.ok ? 'info' : 'warn',
        message: result.ok
          ? `hook ${result.hookId} ok (${hookEvent})`
          : `hook ${result.hookId} failed: ${result.message ?? 'error'}`,
      });
    }
  }

  private async runCronJob(job: import('@piwin/contracts').CronJob): Promise<{
    ok: boolean;
    message?: string;
  }> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const config = await loadPiwinConfig(rootDir);
    if (config.automation?.enabled !== true) {
      return { ok: false, message: 'automation disabled (config.automation.enabled)' };
    }
    if (config.automation?.cronEnabled !== true) {
      return { ok: false, message: 'cron disabled (config.automation.cronEnabled)' };
    }
    if (job.enabled !== true) {
      return { ok: false, message: `job ${job.id} is disabled` };
    }
    const now = new Date().toISOString();
    let promptSessionId: string | undefined;
    try {
      if (job.type === 'prompt') {
        const projectPath = job.projectPath;
        if (!projectPath) {
          throw new Error('prompt cron requires projectPath');
        }
        const text = job.promptText?.trim() || job.name;
        const session = await this.createSession({
          projectPath,
          sessionName: `cron-${job.id.slice(0, 8)}`,
        });
        promptSessionId = session.id;
        await this.bindSession(session, projectPath, `cron-${job.id.slice(0, 8)}`, {
          kind: 'main',
          depth: 0,
        });
        await session.prompt({ text: `[cron:${job.id}] ${text}` });
        const updated = {
          ...job,
          lastRunAt: now,
          lastStatus: 'ok' as const,
        };
        delete (updated as { lastError?: string }).lastError;
        await upsertCronJob(getCronStorePath(rootDir), updated);
        this.push({ type: 'automation/cron_finished', jobId: job.id, ok: true });
        return { ok: true, message: `prompt session ${session.id}` };
      }
      throw new Error(`cron type ${job.type} not enabled in this slice`);
    } catch (error) {
      if (promptSessionId !== undefined) {
        await this.disposeLiveSession(promptSessionId).catch(() => undefined);
      }
      const message = formatError(error);
      const updated = {
        ...job,
        lastRunAt: now,
        lastStatus: 'error' as const,
        lastError: message,
      };
      await upsertCronJob(getCronStorePath(rootDir), updated);
      this.push({
        type: 'automation/cron_finished',
        jobId: job.id,
        ok: false,
        message,
      });
      return { ok: false, message };
    }
  }

  /**
   * ADR 0030 Phase D-3: compose the production SubagentOrchestrator with
   * real worker processes, workspace services, and integration coordinators.
   *
   * Called only in non-mock mode from the constructor. All components are
   * nullable so mock mode and dispose() can safely skip them.
   */
  private composeSubagentOrchestrator(): void {
    // Reuse the foreground supervisor. It is the sole worker process
    // authority for both foreground RPC sessions and subagent tasks.
    if (!this.agentWorkerSupervisor) {
      this.agentWorkerSupervisor = this.createAgentWorkerSupervisor();
    }

    // Create the worker task runner — adapter from SubagentTaskRunner to
    // the worker supervisor.
    const taskRunner = new WorkerTaskRunner({ supervisor: this.agentWorkerSupervisor });

    // Create the workspace service. Use a general-scope path as the default
    // project path; project-scoped sessions will override via the task spec's
    // parentSessionId → sessionProjects lookup in prepareTask.
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const runStore = createSubagentRunStore({ runsDir: join(rootDir, 'subagent-runs') });
    const defaultProjectPath = getPiwinGeneralWorkspacePath(rootDir);
    this.subagentWorkspaceService = createSubagentWorkspaceService({
      projectPath: defaultProjectPath,
      worktreeStorageRoot: join(rootDir, 'worktrees'),
      resolveProjectPath: (task) =>
        this.sessionProjects.get(task.parentSessionId) ?? defaultProjectPath,
      dirtyBasePolicy: async () => {
        const config = await loadPiwinConfig(this.options.piwinRoot);
        return config.subagents?.dirtyBasePolicy ?? 'ask';
      },
      parallelWritePolicy: 'worktree-only',
      requestDirtyBasePermission: async (task, projectPath) => {
        const activeRunId = this.runRegistry.getForegroundRun(task.parentSessionId)?.runId;
        const signal = activeRunId ? this.runRegistry.getSignal(activeRunId) : undefined;
        const decision = await this.requestPermission({
          sessionId: task.parentSessionId,
          projectPath,
          action: 'subagent:dirty-base',
          detail: `Parallel write task ${task.id} wants to start from a dirty repository. Continue for this run?`,
          defaultDecision: 'deny',
          ...(signal ? { signal } : {}),
        });
        return decision === 'allow' ? 'allow' : 'deny';
      },
    });

    // Create the integration coordinator with git functions from @piwin/git.
    const integrationAdapter = createGitWorktreeIntegrationAdapter(integrateWorktreeChanges);
    this.subagentIntegrationCoordinator = createSubagentIntegrationCoordinator({
      integrateWorktree: integrationAdapter,
      isBaseClean: isWorktreeBaseClean,
      removeWorktree: async (
        worktreePath: string,
        parentRepoPath: string,
        worktreeBranch?: string,
      ) => {
        await removeWorktree({
          projectPath: parentRepoPath,
          worktreePath,
          force: true,
          ...(worktreeBranch ? { worktreeBranch } : {}),
        });
      },
    });

    // Create the runtime resource coordinator. The worker supervisor reports
    // processIsolation=true, so effective concurrency equals the configured max.
    const supervisorStatus = this.agentWorkerSupervisor.getStatus();
    this.runtimeResourceCoordinator = createRuntimeResourceCoordinator({
      configuredMaxConcurrency: supervisorStatus.maxActiveWorkers,
      processIsolation: supervisorStatus.processIsolation,
    });

    // Create the orchestrator with a dynamic generation ID getter.
    this.subagentOrchestrator = new SubagentOrchestrator({
      taskRunner,
      workspaceService: this.subagentWorkspaceService,
      prepareTask: (input) => this.prepareSubagentTask(input),
      integrationCoordinator: this.subagentIntegrationCoordinator,
      resourceCoordinator: this.runtimeResourceCoordinator,
      runRegistry: this.runRegistry,
      runStore,
      push: (message) => {
        this.push(message);
        if (message.type === 'subagent/task-updated') {
          void this.persistSubagentTaskResult(message.parentSessionId, message.result).catch(
            (error: unknown) => {
              this.push({
                type: 'host/log',
                level: 'warn',
                message: `subagent session update failed: ${formatError(error)}`,
              });
            },
          );
        }
      },
      getRuntimeGenerationId: (parentSessionId) => {
        const genId = this.runtimeController.getStatus(parentSessionId).generationId;
        if (!genId) {
          throw new Error(
            `subagent runtime generation unavailable for parent session ${parentSessionId}`,
          );
        }
        return genId;
      },
      registerTaskSession: async (input) => {
        this.subagentSessionContexts.set(input.childSessionId, {
          parentSessionId: input.parentSessionId,
          runtimeGenerationId: input.runtimeGenerationId,
          workingDirectory: input.workingDirectory,
          parentRepoPath: input.workspaceLease.parentRepoPath,
        });
        await this.persistSubagentSessionStart(input).catch((error: unknown) => {
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `subagent session registration failed: ${formatError(error)}`,
          });
        });
        if (input.task.model) {
          this.sessionModels.set(input.childSessionId, input.task.model);
        }
        await this.ensureTranscriptRecorder(
          input.childSessionId,
          input.workspaceLease.parentRepoPath,
          input.runtimeGenerationId,
        );
        const recorder = this.transcriptRecorders.get(input.childSessionId);
        if (recorder) {
          await recorder.recordUserPrompt({
            text: input.task.task,
            ...(input.task.model ? { model: input.task.model } : {}),
            ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
          });
        }
      },
      unregisterTaskSession: async (childSessionId) => {
        const recorder = this.transcriptRecorders.get(childSessionId);
        if (recorder) {
          try {
            await recorder.flush();
          } catch (error) {
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `subagent transcript flush failed: ${formatError(error)}`,
            });
          } finally {
            recorder.dispose();
            this.transcriptRecorders.delete(childSessionId);
          }
        }
        this.sessionModels.delete(childSessionId);
        this.subagentSessionContexts.delete(childSessionId);
        this.sessionHostToolPort?.clearSession(childSessionId);
        await this.releaseGenerationToolSurfaces(childSessionId);
      },
    });
  }

  private createAgentWorkerSupervisor(): AgentWorkerSupervisor {
    return new AgentWorkerSupervisor({
      ...(this.options.agentWorkerScript
        ? { worker: { workerScript: this.options.agentWorkerScript } }
        : {}),
      onEvent: (sessionId, event) => {
        const childContext = this.subagentSessionContexts.get(sessionId);
        if (!childContext) return;
        this.push({
          type: 'subagent/stream',
          parentSessionId: childContext.parentSessionId,
          childSessionId: sessionId,
          event,
        });
        const recorder = this.transcriptRecorders.get(sessionId);
        if (recorder) {
          void recorder.recordEvent(event).catch((error: unknown) => {
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `subagent transcript event failed: ${formatError(error)}`,
            });
          });
        }
      },
      onWorkerExit: ({ sessionId, runtimeGenerationId, code }) => {
        const affectedRuns = this.runRegistry
          .list({
            status: ['queued', 'running', 'cancelling'],
          })
          .filter(
            (run) => run.sessionId === sessionId && run.runtimeGenerationId === runtimeGenerationId,
          );
        for (const run of affectedRuns) {
          void this.cleanupAfterWorkerCrash(
            run.runId,
            `worker exited unexpectedly (code ${code ?? 'unknown'})`,
          );
        }
      },
      onToolCall: (frame, signal) => {
        const runId = frame.context.runId;
        if (!runId) {
          return Promise.resolve({
            ok: false,
            code: 'tool-not-available' as const,
            message: 'worker tool call has no active Run identity',
          });
        }
        return this.runExecutionContext.run(
          runId,
          () =>
            this.sessionHostToolPort?.execute(
              {
                sessionId: frame.context.sessionId,
                runtimeGenerationId: frame.context.runtimeGenerationId,
                runId,
                toolName: frame.toolName,
                arguments: (frame.args ?? {}) as Record<string, unknown>,
              },
              signal,
            ) ??
            Promise.resolve({
              ok: false,
              code: 'tool-not-available' as const,
              message: 'host tool port not available',
            }),
        );
      },
    });
  }

  /**
   * Give the normal async owner one turn to observe the worker rejection. If
   * it does not, perform the same job/correlator/transcript cleanup as the
   * regular Run termination path before forcing a failed terminal state.
   */
  private async cleanupAfterWorkerCrash(runId: string, message: string): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const run = this.runRegistry.get(runId);
    if (!run || isRunTerminal(run.status)) return;
    const rootRunId = run.rootRunId;
    if (this.workerCrashCleanupRoots.has(rootRunId)) return;
    this.workerCrashCleanupRoots.add(rootRunId);
    try {
      const subtree = this.runRegistry.list({ rootRunId });
      const activeSiblingRuns = subtree.filter(
        (candidate) =>
          candidate.runId !== runId &&
          candidate.runId !== rootRunId &&
          !isRunTerminal(candidate.status),
      );
      // Close admission for the complete tree, not only the crashed leaf.
      // This prevents sibling tasks from continuing after one worker has died.
      this.runRegistry.cancelRun(rootRunId);
      await Promise.all(
        activeSiblingRuns.map((candidate) => this.runRegistry.join(candidate.runId)),
      );

      for (const candidate of subtree) {
        if (this.jobController) {
          await this.jobController.stopByRun(candidate.runId, 'failed').catch(() => undefined);
        }
        this.runEventCorrelator.markRunTerminal(candidate.sessionId, candidate.runId);
        const recorder = this.transcriptRecorders.get(candidate.sessionId);
        if (recorder) {
          await recorder.flush().catch(() => undefined);
        }
      }

      // The crashed worker has no normal owner left to acknowledge its abort.
      // Terminalize that leaf after siblings have joined so SC-09 remains true;
      // the batch/foreground owner can then finish the root Run normally.
      if (this.runRegistry.isActive(runId)) {
        this.runRegistry.terminate(runId, 'failed', 'worker-crash', message);
      }
    } finally {
      this.workerCrashCleanupRoots.delete(rootRunId);
    }
  }

  /** Persist the product-side child session before its worker can emit tools. */
  private async persistSubagentSessionStart(input: {
    childSessionId: string;
    parentSessionId: string;
    runtimeGenerationId: string;
    workingDirectory: string;
    task: SubagentTaskSpec;
    workspaceLease: SubagentWorkspaceLease;
  }): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const parentRecord = await getSessionRecord(indexPath, input.parentSessionId);
    const projectPath = parentRecord?.projectPath ?? input.workspaceLease.parentRepoPath;
    const scope = parentRecord?.scope ?? {
      kind: 'project' as const,
      projectPath: input.workspaceLease.parentRepoPath,
    };
    const runtimeSnapshot: SubagentRuntimeSnapshot = {
      ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
      ...(input.task.model ? { model: input.task.model } : {}),
      ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
      ...(input.task.capabilities ? { capabilities: [...input.task.capabilities] } : {}),
      ...(input.task.skillIds ? { skillIds: [...input.task.skillIds] } : {}),
      isolation: input.workspaceLease.mode,
      workingDirectory: input.workingDirectory,
    };
    const lifecycle = {
      executionStatus: 'running' as const,
      summaryStatus: 'not-requested' as const,
      integrationStatus:
        input.workspaceLease.mode === 'worktree'
          ? ('pending' as const)
          : ('not-requested' as const),
    };
    const current = await getSessionRecord(indexPath, input.childSessionId);
    const record =
      current ??
      createSessionRecord({
        id: input.childSessionId,
        projectPath,
        scope,
        workingDirectory: input.workingDirectory,
        name: input.task.sessionName ?? `subagent-${input.task.id}`,
        parentSessionId: input.parentSessionId,
        depth: (parentRecord?.depth ?? 0) + 1,
        kind: 'subagent',
        subagentStatus: 'running',
        task: input.task.task,
        subagentMode: input.workspaceLease.mode,
        subagentApplyPolicy: input.task.applyPolicy ?? 'none',
        ...(input.task.allowedOutputPaths
          ? { subagentAllowedOutputPaths: [...input.task.allowedOutputPaths] }
          : {}),
        subagentRetainWorktree: input.task.retainWorktree === true,
        ...(input.workspaceLease.mode === 'worktree'
          ? {
              worktreePath: input.workspaceLease.worktreePath,
              worktreeBranch: input.workspaceLease.worktreeBranch,
            }
          : {}),
        subagentRuntime: runtimeSnapshot,
        subagentLifecycle: lifecycle,
      });

    if (current) {
      current.parentSessionId = input.parentSessionId;
      current.depth = (parentRecord?.depth ?? 0) + 1;
      current.kind = 'subagent';
      current.scope = current.scope ?? scope;
      current.workingDirectory = input.workingDirectory;
      if (!current.name) current.name = input.task.sessionName ?? `subagent-${input.task.id}`;
      current.subagentStatus = 'running';
      current.task = input.task.task;
      current.subagentMode = input.workspaceLease.mode;
      current.subagentApplyPolicy = input.task.applyPolicy ?? 'none';
      if (input.task.allowedOutputPaths) {
        current.subagentAllowedOutputPaths = [...input.task.allowedOutputPaths];
      }
      current.subagentRetainWorktree = input.task.retainWorktree === true;
      if (input.workspaceLease.mode === 'worktree') {
        current.worktreePath = input.workspaceLease.worktreePath;
        current.worktreeBranch = input.workspaceLease.worktreeBranch;
      }
      current.subagentRuntime = runtimeSnapshot;
      current.subagentLifecycle = lifecycle;
    }
    record.updatedAt = new Date().toISOString();
    await upsertSessionRecord(indexPath, record);
    this.push({
      type: 'subagent/updated',
      parentSessionId: input.parentSessionId,
      child: indexRecordToSummary(record),
    });
  }

  /** Persist the terminal execution, summary, and integration axes. */
  private async persistSubagentTaskResult(
    parentSessionId: string,
    result: SubagentTaskResult,
  ): Promise<void> {
    const childSessionId = result.childSessionId;
    if (!childSessionId) return;
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, childSessionId);
    if (!record) return;
    record.updatedAt = new Date().toISOString();
    record.subagentStatus =
      result.executionStatus === 'completed'
        ? 'done'
        : result.executionStatus === 'cancelled'
          ? 'cancelled'
          : result.executionStatus === 'queued' || result.executionStatus === 'running'
            ? 'running'
            : 'failed';
    if (result.summaryPreview) record.summaryPreview = result.summaryPreview;
    if (result.worktreePath) record.worktreePath = result.worktreePath;
    record.subagentLifecycle = {
      executionStatus: result.executionStatus,
      summaryStatus: result.summaryStatus,
      integrationStatus: result.integrationStatus,
    };
    await upsertSessionRecord(indexPath, record);
    this.push({
      type: 'subagent/updated',
      parentSessionId,
      child: indexRecordToSummary(record),
    });
  }

  /** Persist an idempotent summary merge marker and notify session-list clients. */
  private async persistSubagentMerge(
    parentSessionId: string,
    childSessionId: string,
    result: SubagentTaskResult,
    messageId: string,
  ): Promise<boolean> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, childSessionId);
    if (!record) return false;
    if (record.mergeMessageId) return true;
    record.updatedAt = new Date().toISOString();
    record.mergedAt = new Date().toISOString();
    record.mergeMessageId = messageId;
    record.subagentLifecycle = {
      executionStatus: record.subagentLifecycle?.executionStatus ?? result.executionStatus,
      summaryStatus: 'merged',
      integrationStatus: record.subagentLifecycle?.integrationStatus ?? result.integrationStatus,
    };
    await upsertSessionRecord(indexPath, record);
    this.push({
      type: 'subagent/updated',
      parentSessionId,
      child: indexRecordToSummary(record),
    });
    return false;
  }

  /**
   * ADR 0030 Phase D-3: compile a child-specific immutable task package.
   *
   * Loads config, compiles a BackendSessionBlueprint for the child session,
   * and builds the prepared prompt from the task's prompt text. The result
   * is frozen before dispatch — the worker never re-reads Settings or
   * resolves profiles.
   */
  private async prepareSubagentTask(
    input: SubagentTaskPreparationInput,
  ): Promise<PreparedSubagentTask> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    let config: import('@piwin/contracts').PiwinConfig | undefined;
    try {
      config = await loadPiwinConfig(this.options.piwinRoot);
    } catch {
      // Config load failure — use defaults. The blueprint compiler will
      // produce a minimal snapshot.
    }

    // Resolve the project path for the parent session, falling back to
    // the general workspace path.
    const parentProjectPath =
      this.sessionProjects.get(input.task.parentSessionId) ?? getPiwinGeneralWorkspacePath(rootDir);

    // Build the CreateSessionInput for the child session.
    const subagentOptions = {
      mode: input.workspaceLease.mode,
      applyPolicy: input.task.applyPolicy ?? 'none',
      retainWorktree: input.task.retainWorktree === true,
      ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
      ...(input.task.capabilities ? { capabilities: [...input.task.capabilities] } : {}),
      ...(input.task.skillIds ? { skillIds: [...input.task.skillIds] } : {}),
      ...(input.task.allowedOutputPaths
        ? { allowedOutputPaths: [...input.task.allowedOutputPaths] }
        : {}),
    } satisfies import('@piwin/contracts').SubagentSpawnOptions;
    const createInput: import('@piwin/contracts').CreateSessionInput = {
      scope: { kind: 'project', projectPath: parentProjectPath },
      sessionName: input.task.sessionName ?? `subagent-${input.task.id}`,
      ...(input.task.model ? { model: input.task.model } : {}),
      ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
      parentSessionId: input.task.parentSessionId,
      task: input.task.task,
      subagent: subagentOptions,
      cwd: input.workspaceLease.cwd,
      runtimeSnapshot: {
        ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
        ...(input.task.model ? { model: input.task.model } : {}),
        ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
        ...(input.task.capabilities ? { capabilities: [...input.task.capabilities] } : {}),
        ...(input.task.skillIds ? { skillIds: [...input.task.skillIds] } : {}),
        isolation: input.workspaceLease.mode,
        workingDirectory: input.workspaceLease.cwd,
      },
    };

    const hostTools = await this.buildSessionHostToolsForSession(
      input.childSessionId,
      input.runtimeGenerationId,
      input.task.model,
    );
    const rulesRevision = this.generationPermissionRuleRevisions.get(
      `${input.childSessionId}\u0000${input.runtimeGenerationId}`,
    );
    const mcpCapabilityBrief = await this.getGenerationMcpCapabilityBrief(
      input.childSessionId,
      input.runtimeGenerationId,
    );

    // Compile the blueprint for the worker. The blueprint includes the
    // capability snapshot, model, thinking level, and resource manifest.
    const compiled = await compileBlueprintForWorker(createInput, {
      ...(this.options.piwinRoot ? { piwinRoot: this.options.piwinRoot } : {}),
      sessionId: input.childSessionId,
      runtimeGenerationId: input.runtimeGenerationId,
      allowInlineProviderSecrets: false,
      ...(config ? { config } : {}),
      mcpConfig: this.getGenerationMcpConfig(input.childSessionId, input.runtimeGenerationId),
      mcpCapabilityBrief,
      hostToolDescriptors: descriptorsFromTools(hostTools),
      hostToolFamilyIndex: toolFamilyIndex(hostTools),
      ...(rulesRevision !== undefined ? { rulesRevision } : {}),
      // Resolve trust from the project store so untrusted projects
      // cannot compile write/process/bash/delegate capabilities.
      ...(createInput.scope?.kind === 'project'
        ? {
            trustResolver: async (projectPath: string) => {
              try {
                const rootDir = getPiwinRoot(this.options.piwinRoot);
                const projects = await listProjects(getPiwinProjectsPath(rootDir));
                const record = projects.find((p) => p.path === projectPath);
                return record?.trust === 'trusted';
              } catch {
                return false;
              }
            },
          }
        : {}),
    });
    if (
      !this.sessionHostToolPort?.restrictGeneration(
        input.childSessionId,
        input.runtimeGenerationId,
        compiled.backendBlueprint.capabilitySnapshot.tools.hostTools.map((tool) => tool.name),
      )
    ) {
      throw new Error(
        `compiled Host tool surface is not registered: ${input.childSessionId}/${input.runtimeGenerationId}`,
      );
    }

    // Build the prepared prompt from the task text.
    const preparedPrompt: BackendPreparedPrompt = {
      text: input.task.task,
      runId: input.taskRunId,
      ...(input.task.model ? { model: input.task.model } : {}),
      ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
    };

    // Build the runtime snapshot for the child session.
    const runtimeSnapshot: SubagentRuntimeSnapshot = {
      ...(input.task.profileId ? { profileId: input.task.profileId } : {}),
      ...(input.task.model ? { model: input.task.model } : {}),
      ...(input.task.thinkingLevel ? { thinkingLevel: input.task.thinkingLevel } : {}),
      ...(input.task.capabilities ? { capabilities: [...input.task.capabilities] } : {}),
      ...(input.task.skillIds ? { skillIds: [...input.task.skillIds] } : {}),
      isolation: input.workspaceLease.mode,
      workingDirectory: input.workspaceLease.cwd,
    };

    return {
      runtimeSnapshot,
      sessionBlueprint: compiled.backendBlueprint,
      preparedPrompt,
      // The compiled provider envelope is frozen before dispatch. The worker
      // task runner constructs model clients from it without reading settings.
      // `SerializableProviderRuntime` is structurally identical to the
      // contracts-level `SubagentProviderEnvelope`, so this is a safe pass.
      providers: compiled.providers,
    };
  }

  /**
   * ADR 0030 Phase D-3: create the SubagentRunSeam for the model-facing
   * piwin_subagent_run tool. The seam starts a batch with one task, waits
   * for completion, and merges the summary back.
   */
  private getSubagentSeam(sessionId: string): SubagentRunSeam | undefined {
    if (!this.subagentOrchestrator) return undefined;
    const orchestrator = this.subagentOrchestrator;

    return {
      spawn: async (input) => {
        const parentRunId = this.runExecutionContext.getStore();
        const activeScheme = parentRunId
          ? this.runOrchestrationSchemes.get(parentRunId)
          : undefined;
        // ORCH §8.4: scheme ceilings gate concurrent scouts for this parent turn.
        // Unbound (Off) runs skip the gate entirely.
        const admission = await this.schemeAdmissionGate.acquire(parentRunId, input.signal);
        const releaseAdmission = (): void => {
          admission?.release();
        };
        try {
          if (input.signal?.aborted) {
            throw new Error('aborted before subagent spawn');
          }
          const { applySchemeToSubagentSpawnInput } = await import('@piwin/contracts');
          const schemeSpawn = applySchemeToSubagentSpawnInput(activeScheme, {
            ...(input.role ? { role: input.role } : {}),
            ...(input.profileId ? { profileId: input.profileId } : {}),
            ...(input.model ? { model: input.model } : {}),
            ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
          });
          // ORCH-V2: spawn-before unavailability → do not open a child session.
          if (schemeSpawn.fallback) {
            const reason = schemeSpawn.fallback.reason;
            const roleLabel = schemeSpawn.fallback.role;
            if (schemeSpawn.fallback.kind === 'none') {
              throw new Error(
                `subagent role "${roleLabel}" unavailable (fallback=none): ${reason}`,
              );
            }
            throw new Error(
              `subagent-unavailable-fallback-main: role "${roleLabel}" unavailable (${reason}). ` +
                'Complete this subtask in the main session yourself; keep context pollution minimal.',
            );
          }
          // Soft-generic / member isolation: prefer member isolation; generic scouts default readonly.
          let mode = input.mode;
          if (schemeSpawn.isolation) {
            mode = schemeSpawn.isolation;
          } else if (activeScheme && !activeScheme.exposeSpawnMetadata) {
            mode = 'readonly';
          }
          const resolvedModel = schemeSpawn.model;
          const allowInputModel =
            Boolean(input.model) &&
            (!activeScheme || activeScheme.exposeSpawnMetadata) &&
            !schemeSpawn.clearedModel &&
            !resolvedModel;
          // One model tool call = one task; turn-scoped gate limits parallel calls.
          const preparedRequest = await this.prepareSubagentBatch({
            parentSessionId: sessionId,
            tasks: [
              {
                id: randomUUID(),
                parentSessionId: sessionId,
                task: input.task,
                ...(mode ? { isolationOverride: mode } : {}),
                ...(input.applyPolicy ? { applyPolicy: input.applyPolicy } : {}),
                ...(input.sessionName ? { sessionName: input.sessionName } : {}),
                ...(schemeSpawn.profileId ? { profileId: schemeSpawn.profileId } : {}),
                ...(resolvedModel
                  ? { model: resolvedModel }
                  : allowInputModel && input.model
                    ? { model: input.model }
                    : {}),
                ...(schemeSpawn.thinkingLevel ? { thinkingLevel: schemeSpawn.thinkingLevel } : {}),
              },
            ],
            maxConcurrency: 1,
          });
          const handle = orchestrator.startBatch(preparedRequest, parentRunId);
          const cancelBatch = (): void => {
            void orchestrator.cancelBatch(handle.runId).catch(() => {
              // The batch completion is still owned by the orchestrator; the
              // model-facing tool only needs the abort request to be durable.
            });
          };
          if (input.signal?.aborted) {
            cancelBatch();
          } else if (input.signal) {
            input.signal.addEventListener('abort', cancelBatch, { once: true });
          }
          let result: SubagentBatchResult;
          try {
            result = await handle.completion;
          } finally {
            if (input.signal) {
              input.signal.removeEventListener('abort', cancelBatch);
            }
          }
          const taskResult = result.results[0];
          const childSessionId = taskResult?.childSessionId ?? '';
          if (taskResult && childSessionId) {
            this.subagentTaskResults.set(childSessionId, taskResult);
          }
          if (!childSessionId) {
            throw new Error(`subagent batch ${result.status} without a child session result`);
          }
          if (!taskResult) {
            throw new Error(`subagent batch ${result.status} did not return its task result`);
          }
          return {
            childSessionId,
            batchStatus: result.status,
            executionStatus: taskResult.executionStatus,
            integrationStatus: taskResult.integrationStatus,
            ...(taskResult.error ? { error: taskResult.error } : {}),
            ...(taskResult.worktreePath ? { worktreePath: taskResult.worktreePath } : {}),
          };
        } finally {
          releaseAdmission();
        }
      },
      merge: async (childSessionId) => {
        const result = this.subagentTaskResults.get(childSessionId);
        if (!result) {
          throw new Error(`subagent result not found: ${childSessionId}`);
        }
        const messageId = randomUUID();
        const alreadyMerged = await this.persistSubagentMerge(
          sessionId,
          childSessionId,
          result,
          messageId,
        );
        if (!alreadyMerged) {
          this.push({
            type: 'subagent/merged',
            parentSessionId: sessionId,
            childSessionId,
            messageId,
          });
        }
        return {
          ...(result.summaryPreview ? { summaryPreview: result.summaryPreview } : {}),
          alreadyMerged,
        };
      },
    };
  }

  /**
   * Compose Host-owned tools for one session for the parent tool execution port.
   * Permission prompts are bound to this sessionId via requestPermission.
   *
   * `mode` selects where the composed surface is registered:
   * - `active`: the session's current executable generation (initial create,
   *   and the candidate commit step via `commitPendingGeneration`).
   * - `pending`: a candidate generation that cannot execute tool calls until
   *   it is committed (repair spec WP1).
   */
  private async buildSessionHostToolsForSession(
    sessionId: string,
    runtimeGenerationId: string,
    model?: ModelRef,
    mode: ProductAgentHostToolRegistrationMode = 'active',
  ): Promise<HostToolRegistration[]> {
    const surfaceKey = `${sessionId}\u0000${runtimeGenerationId}`;
    let surfacePromise = this.generationToolSurfaces.get(surfaceKey);
    if (!surfacePromise) {
      surfacePromise = this.composeSessionHostToolsForSession(
        sessionId,
        runtimeGenerationId,
        model,
      );
      this.generationToolSurfaces.set(surfaceKey, surfacePromise);
    }
    try {
      const { tools, permissionGate } = await surfacePromise;
      if (mode === 'pending') {
        this.sessionHostToolPort?.registerPendingGeneration(
          sessionId,
          runtimeGenerationId,
          tools,
          permissionGate,
        );
      } else {
        this.sessionHostToolPort?.registerActiveGeneration(
          sessionId,
          runtimeGenerationId,
          tools,
          permissionGate,
        );
      }
      return tools;
    } catch (error) {
      await this.releaseGenerationToolSurface(sessionId, runtimeGenerationId);
      throw error;
    }
  }

  private async composeSessionHostToolsForSession(
    sessionId: string,
    runtimeGenerationId: string,
    model?: ModelRef,
  ): Promise<ComposedSessionHostTools> {
    const childContext = this.subagentSessionContexts.get(sessionId);
    const projectPath = childContext?.workingDirectory ?? this.sessionProjects.get(sessionId);
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    let config: import('@piwin/contracts').PiwinConfig | undefined;
    try {
      config = await loadPiwinConfig(this.options.piwinRoot);
    } catch (error) {
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `config composition failed; config-dependent capabilities omitted: ${formatUnknownError(error)}`,
      });
      // Config load failure — tools that need config will be omitted.
    }
    this.permissionModeFromConfig = config?.permissions?.mode ?? 'auto';
    let mcpConfig: McpConfigDocument | undefined;
    let mcpEnabledServerIds: string[] = [];
    try {
      mcpConfig = await loadMcpConfig(rootDir);
      mcpEnabledServerIds = listEnabledServers(mcpConfig)
        .map((server) => server.id)
        .sort((left, right) => left.localeCompare(right));
    } catch (error) {
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `mcp-config composition failed; MCP capability omitted: ${formatUnknownError(error)}`,
      });
      // Invalid/unreadable MCP config fails closed for this generation.
    }
    const mcpSnapshot = createMcpGenerationSnapshot(
      mcpConfig ?? { mcpServers: {} },
      `${sessionId}\u0000${runtimeGenerationId}`,
    );
    this.generationMcpConfigs.set(`${sessionId}\u0000${runtimeGenerationId}`, mcpSnapshot.config);
    this.generationMcpSnapshots.set(`${sessionId}\u0000${runtimeGenerationId}`, mcpSnapshot);
    let rules = createBundledRuleSet();
    let mcpCapabilityBrief: McpCapabilityBrief | undefined;
    try {
      let projectTrusted = false;
      if (projectPath) {
        const projects = await listProjects(getPiwinProjectsPath(rootDir));
        projectTrusted = projects.some(
          (project) => project.path === projectPath && project.trust === 'trusted',
        );
      }
      rules = await loadMergedPermissionRules({
        piwinRoot: rootDir,
        ...(projectPath ? { projectPath, projectTrusted } : {}),
      });
    } catch (error) {
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `permission-rule composition failed; bundled rules remain active: ${formatUnknownError(error)}`,
      });
      // Bundled rules remain the fail-closed baseline when user/project rules
      // cannot be loaded; the generation still has a deterministic snapshot.
    }
    const tools = await buildSessionHostTools({
      sessionId,
      piwinRoot: rootDir,
      ...(projectPath !== undefined ? { projectPath } : {}),
      jobController: this.jobController,
      ...(this.mcpManager ? { mcpManager: this.mcpManager } : {}),
      mcpConfig: mcpSnapshot.config,
      mcpSnapshot,
      runtimeGenerationId,
      ...(config ? { config } : {}),
      ...(model ? { model } : {}),
      ...(config ? { secretResolver: createSecretResolver() } : {}),
      getBrowserSession: () => this.browserSession ?? undefined,
      getNotesServices: () => this.getNotesServices(),
      getCardStore: () => this.getCardStore(),
      onPlanUpdated: (plan) => {
        this.push({ type: 'plan/updated', sessionId, plan });
      },
      onDiagnostic: ({ message }) => this.push({ type: 'host/log', level: 'warn', message }),
      onMcpCapabilityBrief: (brief) => {
        mcpCapabilityBrief = brief;
      },
      ...(childContext
        ? {}
        : (() => {
            const seam = this.getSubagentSeam(sessionId);
            return seam ? { subagentSeam: seam } : {};
          })()),
    });
    // Repair spec WP3: the permission admission gate is bound to the frozen
    // generation snapshot (rules + MCP allowlist) and reads the dynamic
    // PermissionMode on every call. Executors never re-derive a decision.
    const permissionGate = createHostToolPermissionGate({
      rules,
      getPermissionMode: () =>
        this.sessionPermissionOverrides.get(sessionId) ??
        this.options.permissionModeOverride ??
        this.permissionModeFromConfig,
      getSessionAllowlist: (currentSessionId) => this.sessionAllowlists.get(currentSessionId),
      requestPermission: (input) =>
        this.requestPermission({
          sessionId,
          ...(projectPath !== undefined ? { projectPath } : {}),
          action: input.action,
          detail: input.detail,
          defaultDecision: input.defaultDecision,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
      projectRoot: projectPath ?? rootDir ?? process.cwd(),
      ...(projectPath !== undefined ? { projectPath } : {}),
      projectsFilePath: getPiwinProjectsPath(rootDir),
      mcpEnabledServerIds,
      onDiagnostic: (message) => this.push({ type: 'host/log', level: 'warn', message }),
    });
    this.generationPermissionRuleRevisions.set(
      `${sessionId}\u0000${runtimeGenerationId}`,
      computePermissionRulesRevision(rules),
    );
    if (!mcpCapabilityBrief) {
      throw new Error(
        `MCP capability brief was not produced for ${sessionId}/${runtimeGenerationId}`,
      );
    }
    return { tools, permissionGate, mcpCapabilityBrief };
  }

  private clearGenerationToolSurfaces(sessionId: string): void {
    const prefix = `${sessionId}\u0000`;
    for (const key of this.generationToolSurfaces.keys()) {
      if (key.startsWith(prefix)) {
        this.generationToolSurfaces.delete(key);
      }
    }
    for (const key of this.generationMcpConfigs.keys()) {
      if (key.startsWith(prefix)) {
        this.generationMcpConfigs.delete(key);
      }
    }
    for (const key of this.generationMcpSnapshots.keys()) {
      if (key.startsWith(prefix)) {
        this.generationMcpSnapshots.delete(key);
      }
    }
    for (const key of this.generationPermissionRuleRevisions.keys()) {
      if (key.startsWith(prefix)) {
        this.generationPermissionRuleRevisions.delete(key);
      }
    }
  }

  private clearGenerationToolSurface(sessionId: string, runtimeGenerationId: string): void {
    const key = `${sessionId}\u0000${runtimeGenerationId}`;
    this.generationToolSurfaces.delete(key);
    this.generationMcpConfigs.delete(key);
    this.generationMcpSnapshots.delete(key);
    this.generationPermissionRuleRevisions.delete(key);
  }

  /**
   * Release the MCP runtime owned by one frozen tool surface before dropping
   * its in-memory inputs. Clearing only the maps would leak generation-scoped
   * MCP clients and their child processes.
   */
  private async releaseGenerationToolSurface(
    sessionId: string,
    runtimeGenerationId: string,
  ): Promise<void> {
    const key = `${sessionId}\u0000${runtimeGenerationId}`;
    const snapshot = this.generationMcpSnapshots.get(key);
    this.clearGenerationToolSurface(sessionId, runtimeGenerationId);
    if (!snapshot || !this.mcpManager) {
      return;
    }
    try {
      await this.mcpManager.releaseGenerationSnapshot(snapshot.generationId);
    } catch (error) {
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `MCP generation snapshot cleanup failed for ${sessionId}/${runtimeGenerationId}: ${formatUnknownError(error)}`,
      });
    }
  }

  /** Release all frozen tool surfaces owned by one product session. */
  private async releaseGenerationToolSurfaces(sessionId: string): Promise<void> {
    const prefix = `${sessionId}\u0000`;
    const pendingSurfaces = [...this.generationToolSurfaces.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, surface]) => surface);
    await Promise.allSettled(pendingSurfaces);
    const generationIds = [...this.generationMcpSnapshots.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, snapshot]) => snapshot.generationId);
    this.clearGenerationToolSurfaces(sessionId);
    if (!this.mcpManager) {
      return;
    }
    const results = await Promise.allSettled(
      generationIds.map((generationId) => this.mcpManager?.releaseGenerationSnapshot(generationId)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `MCP generation snapshot cleanup failed for ${sessionId}: ${formatUnknownError(result.reason)}`,
        });
      }
    }
  }

  private getGenerationMcpConfig(
    sessionId: string,
    runtimeGenerationId: string,
  ): McpConfigDocument {
    return (
      this.generationMcpConfigs.get(`${sessionId}\u0000${runtimeGenerationId}`) ?? {
        mcpServers: {},
      }
    );
  }

  private async getGenerationMcpCapabilityBrief(
    sessionId: string,
    runtimeGenerationId: string,
  ): Promise<McpCapabilityBrief> {
    const surface = this.generationToolSurfaces.get(`${sessionId}\u0000${runtimeGenerationId}`);
    if (!surface) {
      throw new Error(
        `MCP capability brief surface is not registered: ${sessionId}/${runtimeGenerationId}`,
      );
    }
    return (await surface).mcpCapabilityBrief;
  }

  /** Resolve profile, model, capabilities, skills, and isolation before admission. */
  private async prepareSubagentBatch(request: SubagentBatchRequest): Promise<SubagentBatchRequest> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const config = await loadPiwinConfig(this.options.piwinRoot);
    const parentRecord = await getSessionRecord(
      getPiwinSessionIndexPath(rootDir),
      request.parentSessionId,
    );
    const projectPath =
      this.sessionProjects.get(request.parentSessionId) ??
      parentRecord?.workingDirectory ??
      parentRecord?.projectPath ??
      getPiwinGeneralWorkspacePath(rootDir);
    const parentModel = this.sessionModels.get(request.parentSessionId) ?? parentRecord?.model;
    const enabledSkillIds = (
      await scanSkills({
        piwinRoot: rootDir,
        projectPath,
        ...(config.skills ? { skillsConfig: config.skills } : {}),
      })
    )
      .filter((skill) => skill.enabled)
      .map((skill) => skill.id);

    const tasks = request.tasks.map((task) => {
      const planned = planSubagentSpawn({
        config,
        request: {
          parentSessionId: request.parentSessionId,
          task: task.task,
          ...(task.sessionName ? { sessionName: task.sessionName } : {}),
          selector: {
            ...(task.profileId ? { profileId: task.profileId } : {}),
            ...(task.model ? { model: task.model } : {}),
            ...(task.thinkingLevel ? { thinkingLevel: task.thinkingLevel } : {}),
          },
          ...(task.isolationOverride ? { mode: task.isolationOverride } : {}),
          ...(task.applyPolicy ? { applyPolicy: task.applyPolicy } : {}),
          ...(task.allowedOutputPaths ? { allowedOutputPaths: [...task.allowedOutputPaths] } : {}),
          ...(task.retainWorktree !== undefined ? { retainWorktree: task.retainWorktree } : {}),
        },
        parentDepth: parentRecord?.depth ?? 0,
        parentKind: parentRecord?.kind,
        workingDirectory: projectPath,
        enabledSkillIds,
      });
      if ('error' in planned) {
        throw new Error(`subagent task ${task.id}: ${planned.error}`);
      }
      const model = planned.snapshot.model ?? parentModel;
      return {
        ...task,
        ...(planned.snapshot.profileId ? { profileId: planned.snapshot.profileId } : {}),
        ...(model ? { model } : {}),
        ...(planned.snapshot.thinkingLevel
          ? { thinkingLevel: planned.snapshot.thinkingLevel }
          : {}),
        isolationOverride: planned.snapshot.isolation,
        ...(planned.spawnOptions.applyPolicy
          ? { applyPolicy: planned.spawnOptions.applyPolicy }
          : {}),
        ...(planned.spawnOptions.retainWorktree !== undefined
          ? { retainWorktree: planned.spawnOptions.retainWorktree }
          : {}),
        ...(planned.snapshot.capabilities
          ? { capabilities: [...planned.snapshot.capabilities] }
          : {}),
        ...(planned.snapshot.skillIds ? { skillIds: [...planned.snapshot.skillIds] } : {}),
      };
    });
    return { ...request, tasks };
  }

  private getJobController(): JobController {
    if (!this.jobController) {
      throw new Error('Job controller is not available');
    }
    return this.jobController;
  }

  /** CE-JOB: forward JobRegistryEvent as JobHostPush to all sinks. */
  private emitJobEvent(event: JobRegistryEvent): void {
    this.push(event);
  }

  private async stopProcessesForSession(sessionId: string): Promise<void> {
    if (!this.jobController) {
      return;
    }
    const cleanup = await this.jobController.stopBySession(sessionId, 'session-closed');
    if (cleanup.failedJobIds.length > 0) {
      // Cleanup failure must reach the lifecycle boundary; the caller decides
      // whether the session transition fails or degrades (ADR 0030 B4).
      throw new Error(
        `session job cleanup failed for ${sessionId}: ${cleanup.failedJobIds.join(', ')}`,
      );
    }
  }

  private getMcpManager(): McpLifecycleManager {
    if (this.hostClosing) {
      throw new Error('host-closing');
    }
    if (!this.mcpManager) {
      this.mcpManager = createMcpLifecycleManager(getPiwinRoot(this.options.piwinRoot));
    }
    return this.mcpManager;
  }

  /**
   * Lazily create the host-owned BrowserSession (ADR 0020). The session object
   * and its push subscription are passive — Chromium launches only when the
   * desktop acquires its mirror lease or an agent performs a browser operation.
   * Frame/state events are forwarded to `this.push` so the desktop panel
   * mirrors the agent's page. Called before the first Pi session creation so
   * `browser_*` tools register without making Chromium resident.
   */
  async ensureBrowserSession(): Promise<import('@piwin/browser').BrowserSession> {
    if (this.browserSession) return this.browserSession;
    if (!this.browserSessionInit) {
      this.browserSessionInit = (async () => {
        const { createBrowserSession } = await import('@piwin/browser');
        const session = createBrowserSession();
        this.browserSessionUnsubscribe = session.subscribe((event) => this.push(event));
        this.browserSession = session;
        return session;
      })();
    }
    return this.browserSessionInit;
  }

  private isRpcWorkerMode(): boolean {
    // RPC mode always means a piwin-owned worker process (ADR 0030 Phase E).
    // The worker backend supports extensions, prompts, and compaction.
    // Stock Pi RPC is not a product path.
    return this.host.mode === 'rpc';
  }

  private buildSessionLiveContext(): SessionLiveContext {
    return {
      ...(this.options.piwinRoot !== undefined ? { piwinRoot: this.options.piwinRoot } : {}),
      host: this.host,
      createSession: (input, options) => this.createSession(input, options),
      sessions: this.sessions,
      sessionFilesTouched: this.sessionFilesTouched,
      sessionLastPromptText: this.sessionLastPromptText,
      sideChatSnapshotInjectedVersions: this.sideChatSnapshotInjectedVersions,
      sessionModels: this.sessionModels,
      loadSessionUsage: (sessionId) => this.loadSessionUsage(sessionId),
      sessionAutoCompactionOverrides: this.sessionAutoCompactionOverrides,
      unsubscribers: this.unsubscribers,
      transcriptRecorders: this.transcriptRecorders,
      push: (message) => this.push(message),
      pushStatus: () => this.pushStatus(),
      requireSession: (sessionId) => this.requireSession(sessionId),
      bindSession: (session, projectPath, sessionName, lineage) =>
        this.bindSession(session, projectPath, sessionName, lineage),
      loadTranscriptMessages: (sessionId) => this.loadTranscriptMessages(sessionId),
      getTranscriptStore: (sessionId) => this.getTranscriptStore(sessionId),
      withTranscriptStore: (sessionId, operation) => this.withTranscriptStore(sessionId, operation),
      loadSideChatSnapshot: async (sessionId) => {
        const rootDir = getPiwinRoot(this.options.piwinRoot);
        const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
        if (record?.kind !== 'side-chat') {
          return undefined;
        }
        return record.sideChatContext;
      },
      stopProcessesForSession: (sessionId) => this.stopProcessesForSession(sessionId),
      recordUserPrompt: (sessionId, input) => this.recordUserPrompt(sessionId, input),
      touchSession: (sessionId, previewText) => this.touchSession(sessionId, previewText),
      needsProductHistoryInjection: (sessionId) =>
        this.pendingColdStartGenerationId(sessionId) !== undefined,
      ensureLiveSession: (sessionId) => this.ensureLiveSession(sessionId),
      activateSessionRuntime: (sessionId, runId, signal) =>
        this.activateSessionRuntime(sessionId, runId, signal),
      markProductHistoryInjected: (sessionId) => {
        this.coldStartHistoryBySession.delete(sessionId);
      },
      resolveAutoCompaction: (sessionId) => this.resolveAutoCompaction(sessionId),
      buildModelPromptInput: (input, signal) => this.buildModelPromptInput(input, signal),
      validatePromptAttachments: (input) => this.validatePromptAttachments(input),
      loadConfig: () => loadPiwinConfig(this.options.piwinRoot),
      setRunOrchestrationScheme: (runId, scheme) => {
        if (scheme) {
          this.runOrchestrationSchemes.set(runId, scheme);
          this.schemeAdmissionGate.bind(runId, {
            maxConcurrency: scheme.maxConcurrency,
            maxTasksPerRun: scheme.maxTasksPerRun,
          });
        } else {
          this.runOrchestrationSchemes.delete(runId);
          this.schemeAdmissionGate.clear(runId);
        }
      },
      getRunOrchestrationScheme: (runId) => this.runOrchestrationSchemes.get(runId),
      listKnownSubagentProfileIds: async () => {
        const config = await loadPiwinConfig(this.options.piwinRoot);
        const { resolveSubagentProfiles } = await import('./subagent-profile-resolver.js');
        return resolveSubagentProfiles(config).map((profile) => profile.id);
      },
      runWithContext: (runId, operation) => {
        void this.runExecutionContext.run(runId, operation);
      },
      flushTranscriptRecorder: async (sessionId) => {
        const recorder = this.transcriptRecorders.get(sessionId);
        if (recorder) {
          await recorder.flush();
        }
      },
      getForegroundRun: (sessionId) => this.runRegistry.getForegroundRun(sessionId),
      registerForegroundRun: (sessionId, resumeCheckpointId) => {
        const generationId = this.runtimeController.getStatus(sessionId).generationId;
        const parentRunId = this.runExecutionContext.getStore();
        const run = this.runRegistry.createForegroundRun(
          sessionId,
          generationId,
          resumeCheckpointId,
          parentRunId,
        );
        // ADR 0040 §5: a runtime with an active Run is busy and never evicted.
        if (generationId !== undefined) {
          this.residencyController.markBusy(sessionId, generationId);
        }
        return run;
      },
      getRunSignal: (runId) => this.runRegistry.getSignal(runId),
      hasRunReceivedFirstToken: (runId) => this.runRegistry.hasFirstToken(runId),
      /** ADR 0040 §5: explicit protection lease (compaction / backend op). */
      protectRuntime: (sessionId) => {
        const generationId = this.runtimeController.getStatus(sessionId).generationId;
        return generationId !== undefined
          ? this.residencyController.protect(sessionId, generationId)
          : false;
      },
      releaseRuntimeProtection: (sessionId) => {
        const generationId = this.runtimeController.getStatus(sessionId).generationId;
        if (generationId !== undefined) {
          this.residencyController.releaseProtection(sessionId, generationId);
        }
      },
      requestCancelRun: (sessionId, runId, reason) => {
        const active = this.runRegistry.getForegroundRun(sessionId);
        if (!active || (runId !== undefined && active.runId !== runId)) return undefined;
        return this.runRegistry.requestCancel(active.runId, reason);
      },
      requestPauseRun: (sessionId, runId, reason) => {
        const active = this.runRegistry.getForegroundRun(sessionId);
        if (!active || (runId !== undefined && active.runId !== runId)) return undefined;
        return this.runRegistry.requestPause(active.runId, reason);
      },
      isPauseRequested: (runId) => this.runRegistry.isPauseRequested(runId),
      hasActiveDescendants: (runId) => this.runRegistry.hasActiveDescendants(runId),
      attachResumeCheckpoint: (runId, checkpointId) => {
        const attached = this.runRegistry.attachResumeCheckpoint(runId, checkpointId);
        if (!attached) {
          throw new Error(`cannot attach pause checkpoint to run ${runId}`);
        }
      },
      getActivePauseCheckpoint: (sessionId) =>
        this.withTranscriptStore(sessionId, (store) => store.getActivePauseCheckpoint()),
      getPauseCheckpoint: (sessionId, checkpointId) =>
        this.withTranscriptStore(sessionId, (store) => store.getPauseCheckpoint(checkpointId)),
      createPauseCheckpoint: (sessionId, input) =>
        this.withTranscriptStore(sessionId, (store) => store.createPauseCheckpoint(input)),
      consumePauseCheckpoint: (sessionId, checkpointId) =>
        this.withTranscriptStore(sessionId, (store) => store.consumePauseCheckpoint(checkpointId)),
      clearPauseCheckpoint: (sessionId, checkpointId) =>
        this.withTranscriptStore(sessionId, (store) => store.clearPauseCheckpoint(checkpointId)),
      updateRunPhase: (runId, phase, detail) => {
        this.runRegistry.updatePhase(runId, phase, detail);
      },
      terminateRun: async (sessionId, runId, outcome, code, message, options) => {
        const run = this.runRegistry.get(runId);
        if (
          !run ||
          run.sessionId !== sessionId ||
          (run.status === 'cancelling' && outcome === 'completed')
        ) {
          return false;
        }
        const jobReason =
          outcome === 'completed'
            ? 'run-completed'
            : outcome === 'failed'
              ? 'failed'
              : 'run-cancelled';
        let cleanupFailed = false;
        if (this.jobController && options?.skipJobCleanup !== true) {
          try {
            const cleanup = await this.jobController.stopByRun(runId, jobReason);
            cleanupFailed = cleanup.failedJobIds.length > 0;
          } catch (error) {
            cleanupFailed = true;
            const detail = formatError(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `run job cleanup failed for ${runId}: ${detail}`,
            });
          }
        }
        const effectiveOutcome = cleanupFailed ? 'failed' : outcome;
        const effectiveCode: RunTerminalCode = cleanupFailed
          ? 'job-cleanup-failed'
          : outcome === 'cancelled'
            ? 'cancelled'
            : outcome === 'completed'
              ? 'completed'
              : outcome === 'paused'
                ? 'paused'
                : code === 'model-connect-timeout' ||
                    code === 'model-first-token-timeout' ||
                    code === 'model-turn-timeout' ||
                    code === 'mcp-timeout'
                  ? 'timeout'
                  : code === 'runtime-memory-pressure'
                    ? code
                    : 'failed';
        const effectiveMessage = cleanupFailed ? (message ?? 'job cleanup failed') : message;
        const terminalStatus = effectiveOutcome === 'paused' ? 'interrupted' : effectiveOutcome;
        const checkpointId = run.resumeCheckpointId;
        if (checkpointId !== undefined) {
          try {
            if (effectiveOutcome === 'completed') {
              await this.withTranscriptStore(sessionId, (store) =>
                store.consumePauseCheckpoint(checkpointId),
              );
            } else if (effectiveOutcome === 'cancelled') {
              await this.withTranscriptStore(sessionId, (store) =>
                store.clearPauseCheckpoint(checkpointId),
              );
            }
          } catch (error) {
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `pause checkpoint finalization failed for ${runId}: ${formatError(error)}`,
            });
          }
        }
        const terminal = this.runRegistry.terminate(
          runId,
          terminalStatus,
          effectiveCode,
          effectiveMessage,
        );
        if (!terminal) return false;
        // ADR 0040 §5/§7: the terminal Run releases busy residency, wakes any
        // queued activation waiter, and restarts the idle TTL clock.
        const terminalGenerationId = this.runtimeController.getStatus(sessionId).generationId;
        if (terminalGenerationId !== undefined) {
          this.residencyController.markIdle(sessionId, terminalGenerationId);
        }
        // ORCH: drop turn-scoped scheme binding when the run ends.
        this.runOrchestrationSchemes.delete(runId);
        this.schemeAdmissionGate.clear(runId);
        this.runEventCorrelator.markRunTerminal(sessionId, runId);
        // CE-NAME: auto-name after first completed exchange (fire-and-forget).
        if (outcome === 'completed') {
          void this.maybeTriggerAutoName(sessionId).catch((error: unknown) => {
            const detail = formatError(error);
            this.push({ type: 'host/log', level: 'warn', message: `auto-name failed: ${detail}` });
          });
          // Walkthrough is generated on plan completion, not after ordinary runs.
        }
        const recorder = this.transcriptRecorders.get(sessionId);
        if (recorder) {
          void recorder.flush().catch((error: unknown) => {
            const detail = formatError(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `transcript terminal flush failed: ${detail}`,
            });
          });
        }
        return true;
      },
      settlePendingPermissionsForSession: (sessionId) => {
        for (const [requestId, pending] of this.pendingPermissions.entries()) {
          if (pending.sessionId === sessionId) {
            pending.resolve('deny');
            this.pendingPermissions.delete(requestId);
          }
        }
      },
      settlePendingExtensionUiForSession: (sessionId) =>
        this.settlePendingExtensionUiForSession(sessionId),
      setSessionPermissionOverride: (sessionId, mode) =>
        this.setSessionPermissionOverride(sessionId, mode),
      clearSessionPermissionOverride: (sessionId) => this.clearSessionPermissionOverride(sessionId),
      runtimeController: this.runtimeController,
      resetSessionEventState: (sessionId) => this.resetSessionEventState(sessionId),
      cancelRuntimeReplacement: (sessionId) => this.runtimeReplacementEngine.cancel(sessionId),
      disposeLiveSession: (sessionId, reason) => this.disposeLiveSession(sessionId, reason),
      quarantineSessionRuntime: (sessionId, runId) =>
        this.quarantineSessionRuntime(sessionId, runId),
      reloadRuntime: (request) =>
        this.runtimeReplacementEngine.replace(request).then((result) => ({
          generationId: result.candidate.generationId,
          settingsRevision: result.candidate.settingsRevision,
        })),
    };
  }

  private ensurePetStateStore(): Promise<PetStateStore> {
    if (this.petStateStoreInit) return this.petStateStoreInit;
    this.petStateStoreInit = (async () => {
      const root = getPiwinRoot(this.options.piwinRoot);
      let base: PetRuntimeSnapshot;
      try {
        base = await getActivePet(root, 'idle');
      } catch {
        base = fallbackPetSnapshot();
      }
      const store = createPetStateStore({ basePet: base });
      store.subscribe((snapshot) => {
        this.push({ type: 'pet/state', pet: snapshot.pet });
      });
      this.petStateStore = store;
      return store;
    })();
    return this.petStateStoreInit;
  }

  /**
   * Builds the WalkthroughCommandContext seam (spec §11.1) shared by the SDK
   * and RPC adapters. The seam reads config/transcript/plan from disk and the
   * live session model from the in-memory map, so walkthrough handlers never
   * depend on HostRuntime directly.
   */
  private buildWalkthroughContext(): WalkthroughCommandContext {
    return {
      ...(this.options.piwinRoot !== undefined ? { piwinRoot: this.options.piwinRoot } : {}),
      push: (message) => this.push(message),
      loadTranscriptMessages: (sessionId) => this.loadTranscriptMessages(sessionId),
      getTranscriptMessage: (sessionId, messageId) =>
        this.withTranscriptStore(sessionId, (store) => store.getMessage(messageId)),
      hasLaterAssistant: (sessionId, messageId, runId) =>
        this.withTranscriptStore(sessionId, (store) => store.hasLaterAssistant(messageId, runId)),
      loadSessionPlan: (sessionId) => this.loadSessionPlanForWalkthrough(sessionId),
      loadConfig: () => loadPiwinConfig(this.options.piwinRoot),
      resolveSessionModel: (sessionId) => this.sessionModels.get(sessionId),
    };
  }

  private async loadSessionPlanForWalkthrough(sessionId: string): Promise<SessionPlan | null> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const planPath = getPiwinSessionPlanPath(rootDir, sessionId);
    return loadSessionPlan(planPath);
  }

  private async buildDomainContext(): Promise<
    import('./commands/domain-command-dispatch.js').DomainDispatchContext
  > {
    const subagentOrchestrator = this.subagentOrchestrator;
    const hostContext: HostCommandContext = {
      ...(this.options.piwinRoot !== undefined ? { piwinRoot: this.options.piwinRoot } : {}),
      push: (message) => this.push(message),
      requireSession: (sessionId) => this.requireSession(sessionId),
      getMcpManager: () => this.getMcpManager(),
      getJobController: () => this.getJobController(),
      getBrowserSession: () => this.browserSession ?? undefined,
      todoStore: this.todoStore,
      petStateStore: await this.ensurePetStateStore(),
      runCronJob: (job) => this.runCronJob(job),
      pendingPermissions: this.pendingPermissions,
      pendingExtensionUi: this.pendingExtensionUi,
      rememberProjectPermission: (sessionId, action, detail, scope, projectPath) =>
        this.rememberProjectPermission(sessionId, action, detail, scope, projectPath),
      rememberSessionPermission: (sessionId, action, detail) =>
        this.rememberSessionPermission(sessionId, action, detail),
      sessionPermissionOverrides: this.sessionPermissionOverrides,
      setSessionPermissionOverride: (sessionId, mode) =>
        this.setSessionPermissionOverride(sessionId, mode),
      clearSessionPermissionOverride: (sessionId) => this.clearSessionPermissionOverride(sessionId),
      planExecution: {
        promptSession: (sessionId, text, parentRunId) =>
          this.promptPlanSession(sessionId, text, parentRunId),
        abortSession: (sessionId) => this.abortPlanSession(sessionId),
        startPlanRun: (sessionId, planId) => {
          const generationId =
            this.runtimeController.getStatus(sessionId).generationId ??
            `plan-generation-${randomUUID()}`;
          const run = this.runRegistry.create({
            kind: 'plan-execution',
            sessionId,
            planId,
            runtimeGenerationId: generationId,
          });
          const started = this.runRegistry.start(run.runId);
          if (!started) {
            throw new Error(`plan Run failed to start: ${run.runId}`);
          }
          return { runId: started.runId };
        },
        finishPlanRun: (runId, status, error) => {
          this.runRegistry.terminate(runId, status, status, error);
        },
        cancelPlanRun: (runId) => {
          if (runId) {
            this.subagentOrchestrator?.cancelBatchesForParentRun(runId);
            this.runRegistry.cancelRun(runId);
          }
        },
        mergeBatchSummaries: async (parentSessionId, results) => {
          for (const result of results) {
            const childSessionId = result.childSessionId;
            if (!childSessionId || !result.summaryPreview) continue;
            this.subagentTaskResults.set(childSessionId, result);
            const messageId = randomUUID();
            const alreadyMerged = await this.persistSubagentMerge(
              parentSessionId,
              childSessionId,
              result,
              messageId,
            );
            if (!alreadyMerged) {
              this.push({
                type: 'subagent/merged',
                parentSessionId,
                childSessionId,
                messageId,
              });
            }
          }
        },
        runBatch: async (request, parentRunId) => {
          if (!this.subagentOrchestrator) {
            return {
              runId: 'no-orchestrator',
              status: 'failed' as const,
              results: request.tasks.map((task) => ({
                runId: 'no-orchestrator',
                taskId: task.id,
                executionStatus: 'failed' as const,
                summaryStatus: 'not-requested' as const,
                integrationStatus: 'not-requested' as const,
              })),
            };
          }
          // ORCH §8.4: clamp multi-task batches under an active parent scheme.
          let batchRequest = request;
          const activeScheme = parentRunId
            ? this.runOrchestrationSchemes.get(parentRunId)
            : undefined;
          if (activeScheme) {
            if (request.tasks.length > activeScheme.maxTasksPerRun) {
              throw new Error(
                `orchestration scheme maxTasksPerRun (${activeScheme.maxTasksPerRun}) exceeded for this turn`,
              );
            }
            const clampedConcurrency = Math.min(
              request.maxConcurrency ?? activeScheme.maxConcurrency,
              activeScheme.maxConcurrency,
            );
            batchRequest = {
              ...request,
              maxConcurrency: Math.max(1, clampedConcurrency),
            };
          }
          const preparedRequest = await this.prepareSubagentBatch(batchRequest);
          const handle = this.subagentOrchestrator.startBatch(preparedRequest, parentRunId);
          return handle.completion;
        },
      },
      walkthrough: {
        context: this.buildWalkthroughContext(),
        registry: this.walkthroughRegistry,
      },
      knowledge: {
        getNotesServices: () => this.getNotesServices(),
        getCardStore: () => this.getCardStore(),
        getFolderRag: () => this.getFolderRag(),
        loadConfig: () => loadPiwinConfig(this.options.piwinRoot),
      },
      ...(subagentOrchestrator
        ? {
            subagent: {
              prepareBatch: (request: SubagentBatchRequest) => this.prepareSubagentBatch(request),
              startBatch: (request: SubagentBatchRequest, parentRunId?: string) =>
                subagentOrchestrator.startBatch(request, parentRunId),
              getBatchProjection: (runId: string) =>
                subagentOrchestrator.getBatchProjectionAsync(runId),
              cancelBatch: (runId: string) => subagentOrchestrator.cancelBatch(runId),
            },
          }
        : {}),
    };
    return {
      ...hostContext,
      sessionProduct: {
        ...(this.options.piwinRoot !== undefined ? { piwinRoot: this.options.piwinRoot } : {}),
        createSession: (input) => this.createSession(input),
        loadTranscriptMessages: (sessionId) => this.loadTranscriptMessages(sessionId),
        getTranscriptStore: (sessionId, projectPath) =>
          this.getTranscriptStore(sessionId, projectPath),
        withTranscriptStore: (sessionId, operation, projectPath) =>
          this.withTranscriptStore(sessionId, operation, projectPath),
        abortLiveSession: (sessionId) => this.abortLiveSession(sessionId),
        disposeLiveSession: (sessionId) => this.disposeLiveSession(sessionId),
        bindSession: (session, projectPath, sessionName, lineage) =>
          this.bindSession(session, projectPath, sessionName, lineage),
        push: (message) => this.push(message),
        pushStatus: () => this.pushStatus(),
      },
    };
  }

  private async ensureRuntimeRetentionLoaded(): Promise<void> {
    if (this.runtimeRetentionInitialization === null) {
      this.runtimeRetentionInitialization = loadPiwinConfig(this.options.piwinRoot)
        .then((config) => {
          this.applyRuntimeRetention(config.session?.runtimeRetention);
        })
        .catch((error: unknown) => {
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `[residency] failed to load runtime retention; defaults remain active: ${formatError(error)}`,
          });
        });
    }
    await this.runtimeRetentionInitialization;
  }

  private applyRuntimeRetention(input: Partial<SessionRuntimeRetentionConfig> | undefined): void {
    const normalized = normalizeSessionRuntimeRetentionConfig(input);
    const memoryHighWaterMiB =
      normalized.memoryHighWaterMiB ?? deriveMemoryHighWaterMiB(totalmem() / 1024 / 1024);
    this.runtimeRetention = normalized;
    this.runtimeMemoryHighWaterMiB = memoryHighWaterMiB;
    this.residencyController.updateRetention({
      ...normalized,
      memoryHighWaterMiB,
    });
  }

  private getStatus(): HostStatusData {
    return {
      mode: this.host.mode,
      ready: this.ready,
      mock: this.options.mock === true || process.env.PIWIN_MOCK === '1',
      piwinRoot: getPiwinRoot(this.options.piwinRoot),
      activeSessionIds: [...this.sessions.keys()],
      capabilities: {
        // True only when the real parent-owned session tool port is composed
        // (non-mock live path). Mock has no product tool executors wired.
        customTools: this.sessionHostToolPort !== null,
        mcpLifecycle: true,
        productTranscript: true,
        // Compaction requires a live handle with compact(); SDK/mock support it.
        compaction:
          this.host.mode === 'sdk' || this.options.mock === true || this.isRpcWorkerMode(),
        extensions:
          this.host.mode === 'sdk' || this.isRpcWorkerMode() || this.options.mock === true,
        prompts: this.host.mode === 'sdk' || this.isRpcWorkerMode() || this.options.mock === true,
        extensionUiBridge: true,
        sessionSearch: true,
        sessionPin: true,
        sessionLifecycle: true,
        sessionPause: true,
        runtimeResidency: true,
        sessionOutlinePage: true,
        sessionUserMessageIndex: true,
        sessionTranscriptSeek: true,
        usage: true,
        process: true,
        // Keep this fail-closed if construction or the command surface ever
        // regresses; a mode alone is not evidence that jobs are available.
        jobs: this.hasUsableJobController(),
        sessionExport: true,
        // ADR 0013: real Tauri PTY not shipped — do not claim interactive PTY.
        pty: false,
        // ADR 0030: subagent worktree is available when the orchestrator is composed.
        subagentWorktree: this.subagentOrchestrator !== null,
        marketplaceHub: true,
        automation: true,
      },
    };
  }

  private hasUsableJobController(): boolean {
    const controller = this.jobController;
    if (!controller) {
      return false;
    }
    return (
      typeof controller.start === 'function' &&
      typeof controller.list === 'function' &&
      typeof controller.get === 'function' &&
      typeof controller.readLogs === 'function' &&
      typeof controller.wait === 'function' &&
      typeof controller.stop === 'function'
    );
  }

  private pushStatus(): void {
    const status = this.getStatus();
    this.push({
      type: 'host/status',
      mode: status.mode,
      ready: status.ready,
      mock: status.mock,
    });
  }

  private async bindSession(
    session: SessionHandle,
    projectPath?: string,
    sessionName?: string,
    lineage?: SessionLineage,
    bindingGenerationId?: string,
  ): Promise<void> {
    const bindingRuntimeGenerationId =
      bindingGenerationId ?? this.runtimeController.getStatus(session.id).generationId;
    if (
      bindingRuntimeGenerationId !== undefined &&
      this.residencyController.getResidency(session.id) === 'cold'
    ) {
      throw new Error(
        `runtime-residency-invariant: ${session.id}/${bindingRuntimeGenerationId} was created before admission`,
      );
    }
    const existing = this.unsubscribers.get(session.id);
    if (existing) {
      existing();
    }
    this.sessions.set(session.id, session);
    // projectPath may be '' for General sessions — still bind maps + index.
    if (projectPath !== undefined) {
      this.sessionProjects.set(session.id, projectPath);
      const rootDir = getPiwinRoot(this.options.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      try {
        const current = await getSessionRecord(indexPath, session.id);
        if (current) {
          current.updatedAt = new Date().toISOString();
          if (sessionName) {
            current.name = sessionName;
          }
          if (lineage?.parentSessionId) {
            current.parentSessionId = lineage.parentSessionId;
          }
          if (lineage?.kind) {
            current.kind = lineage.kind;
          }
          if (typeof lineage?.depth === 'number') {
            current.depth = lineage.depth;
          }
          if (lineage?.subagentStatus) {
            current.subagentStatus = lineage.subagentStatus;
          }
          if (lineage?.task) {
            current.task = lineage.task;
          }
          applySubagentLineage(current, lineage);
          await upsertSessionRecord(indexPath, current);
        } else {
          const recordInput: Parameters<typeof createSessionRecord>[0] = {
            id: session.id,
            projectPath,
            // No placeholder name: unnamed sessions stay off the sidebar until
            // the first user message assigns a text title.
            ...(sessionName ? { name: sessionName } : {}),
          };
          if (!projectPath) {
            recordInput.scope = { kind: 'general' };
            recordInput.workingDirectory = getPiwinGeneralWorkspacePath(rootDir);
          } else {
            recordInput.scope = { kind: 'project', projectPath };
            recordInput.workingDirectory = projectPath;
          }
          if (lineage?.parentSessionId) {
            recordInput.parentSessionId = lineage.parentSessionId;
          }
          if (lineage?.kind) {
            recordInput.kind = lineage.kind;
          }
          if (typeof lineage?.depth === 'number') {
            recordInput.depth = lineage.depth;
          }
          if (lineage?.subagentStatus) {
            recordInput.subagentStatus = lineage.subagentStatus;
          }
          if (lineage?.task) {
            recordInput.task = lineage.task;
          }
          copySubagentLineage(recordInput, lineage);
          await upsertSessionRecord(indexPath, createSessionRecord(recordInput));
        }
      } catch (error) {
        // best-effort index write — surface failure so users see why a
        // session may be missing from the list (corrupt index, permissions).
        const detail = formatError(error);
        const warning = `session index write failed: ${detail}`;
        console.warn(warning);
        this.push({
          type: 'host/log',
          level: 'warn',
          message: warning,
        });
      }
    }

    const boundRuntimeGenerationId = bindingRuntimeGenerationId;
    await this.ensureTranscriptRecorder(
      session.id,
      projectPath ?? this.sessionProjects.get(session.id) ?? 'unknown',
      boundRuntimeGenerationId ?? `host-untracked-${randomUUID()}`,
    );

    // Capture parent session id for subagent event forwarding (inline stream UX).
    const parentSessionId = lineage?.parentSessionId;

    const unsubscribe = session.subscribe((event: AgentEvent) => {
      const currentRuntimeGenerationId = this.runtimeController.getStatus(session.id).generationId;
      if (currentRuntimeGenerationId !== boundRuntimeGenerationId) {
        // A late callback from a disposed generation must not reach transcript,
        // usage, hooks, or UI state after replacement/recovery.
        return;
      }
      const activeRun = this.runRegistry.getForegroundRun(session.id);
      const correlation = this.runEventCorrelator.correlate(
        session.id,
        event,
        activeRun?.runId,
        this.runExecutionContext.getStore(),
      );
      if (!correlation.accepted) {
        if (hasExplicitRunId(event)) {
          // Stale explicit events are dropped at the host boundary. In
          // particular, do not let them reach hooks, usage, or transcript.
          return;
        }
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `discarded uncorrelated session event: ${event.type}`,
        });
        return;
      }
      const correlatedEvent = correlation.event;
      const correlatedRunId = readEventRunId(correlatedEvent);
      const activeRunId = activeRun?.runId;
      const correlatedRun = correlatedRunId ? this.runRegistry.get(correlatedRunId) : undefined;
      if (
        correlatedRunId !== undefined &&
        ((correlatedRun !== undefined && isRunTerminal(correlatedRun.status)) ||
          (activeRunId !== undefined && correlatedRunId !== activeRunId))
      ) {
        // Context-owned events can have no explicit runId. The correlator
        // annotates them, and this second check prevents old async callbacks
        // from reaching push, hooks, usage, or transcript recording.
        return;
      }
      // Attach logical documentTargets for Doc Preview without rewriting
      // targetPaths (actual tool evidence stays intact).
      const projectPathForTargets = this.sessionProjects.get(session.id) ?? projectPath ?? null;
      const eventForClients = enrichAgentEventDocumentTargets(correlatedEvent, {
        ...(projectPathForTargets ? { projectPath: projectPathForTargets } : {}),
      });
      this.push({ type: 'event', sessionId: session.id, event: eventForClients });
      // Forward child session events to parent for inline subagent stream UX.
      if (parentSessionId) {
        this.push({
          type: 'subagent/stream',
          parentSessionId,
          childSessionId: session.id,
          event: eventForClients,
        });
      }
      void this.ensurePetStateStore().then((store) => store.reduce(eventForClients));
      const eventRunId = correlatedRunId ?? activeRunId;
      if (eventRunId !== undefined) {
        this.runRegistry.noteAgentEvent(eventRunId, eventForClients);
      }
      if (eventForClients.type === 'permission/request') {
        this.push({
          type: 'permission/request',
          sessionId: session.id,
          requestId: eventForClients.requestId,
          action: eventForClients.action,
          detail: eventForClients.detail,
          defaultDecision: eventForClients.defaultDecision,
          ...(eventForClients.runId ? { runId: eventForClients.runId } : {}),
        });
      }
      if (event.type === 'usage/update') {
        const currentUsage = this.sessionUsage.get(session.id);
        if (!shouldAcceptContextUsage(currentUsage, event.usage)) {
          return;
        }
        this.sessionUsage.set(session.id, event.usage);
        // CE-OBS: only agent_end (assistant-usage) is a billable per-turn
        // count. pi-contextUsage is cumulative context occupancy — never sum.
        if (event.usage.source !== 'pi-contextUsage') {
          void this.recordUsageToLedger(session.id, event.usage);
        }
      }
      if (
        eventForClients.type === 'compaction/end' &&
        eventForClients.ok !== false &&
        typeof eventForClients.tokensAfter === 'number'
      ) {
        const previous = this.sessionUsage.get(session.id);
        const tokensAfter = eventForClients.tokensAfter;
        this.sessionUsage.set(session.id, {
          sessionId: session.id,
          ...(previous?.modelId ? { modelId: previous.modelId } : {}),
          tokensUsed: tokensAfter,
          ...(typeof previous?.tokensLimit === 'number'
            ? { tokensLimit: previous.tokensLimit }
            : {}),
          totalTokens: tokensAfter,
          ...(typeof previous?.tokensLimit === 'number' && previous.tokensLimit > 0
            ? { contextRatio: tokensAfter / previous.tokensLimit }
            : {}),
          updatedAt: new Date().toISOString(),
          source: 'pi-contextUsage',
        });
      }
      // CE-OBS: if mock/host did not emit usage, estimate after assistant message ends.
      if (correlatedEvent.type === 'message/end') {
        void this.maybeEmitUsageOnMessageEnd(session.id, correlatedEvent.messageId);
      }
      // CE-NAME: capture the assistant reply from the event stream so
      // auto-naming can give the LLM title generator exchange context.
      if (correlatedEvent.type === 'message/start' && correlatedEvent.role === 'assistant') {
        this.assistantTextBuffers.set(correlatedEvent.messageId, '');
      } else if (correlatedEvent.type === 'message/text_delta') {
        const buffer = this.assistantTextBuffers.get(correlatedEvent.messageId);
        if (buffer !== undefined) {
          this.assistantTextBuffers.set(correlatedEvent.messageId, buffer + correlatedEvent.delta);
        }
      } else if (correlatedEvent.type === 'message/text_snapshot') {
        const buffer = this.assistantTextBuffers.get(correlatedEvent.messageId);
        if (buffer !== undefined) {
          this.assistantTextBuffers.set(correlatedEvent.messageId, correlatedEvent.text);
        }
      } else if (correlatedEvent.type === 'message/end') {
        const reply = this.assistantTextBuffers.get(correlatedEvent.messageId);
        if (reply !== undefined) {
          this.assistantTextBuffers.delete(correlatedEvent.messageId);
          this.sessionLastAssistantReply.set(session.id, reply);
        }
      }
      // CE-HOOK: arm matching hooks on normalized AgentEvent (best-effort, never fails turn).
      void this.dispatchHooksForAgentEvent(session.id, eventForClients).catch((error: unknown) => {
        const message = formatError(error);
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `hook dispatch failed: ${message}`,
        });
      });
      const recorder = this.transcriptRecorders.get(session.id);
      if (recorder) {
        void recorder.recordEvent(eventForClients).catch((error: unknown) => {
          const message = formatError(error);
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `transcript event write failed: ${message}`,
          });
        });
      }
    });
    this.unsubscribers.set(session.id, unsubscribe);

    const pendingDirectGeneration = this.pendingDirectActivations.get(session.id);
    if (
      pendingDirectGeneration !== undefined &&
      pendingDirectGeneration === boundRuntimeGenerationId
    ) {
      this.pendingDirectActivations.delete(session.id);
      this.residencyController.commitActivation(session.id, pendingDirectGeneration);
    }

    // Apply durable auto-compaction default (or session override) when handle supports it.
    void this.applyAutoCompactionToSession(session).catch((error: unknown) => {
      const message = formatError(error);
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `auto-compaction apply failed: ${message}`,
      });
    });
  }

  private async resolveAutoCompaction(sessionId: string): Promise<{
    enabled: boolean;
    source: 'session' | 'global' | 'unknown';
    globalDefault: boolean;
  }> {
    const config = await loadPiwinConfig(getPiwinRoot(this.options.piwinRoot));
    const globalDefault = config.compaction?.autoEnabledDefault !== false;
    if (this.sessionAutoCompactionOverrides.has(sessionId)) {
      return {
        enabled: Boolean(this.sessionAutoCompactionOverrides.get(sessionId)),
        source: 'session',
        globalDefault,
      };
    }
    return { enabled: globalDefault, source: 'global', globalDefault };
  }

  private async applyAutoCompactionToSession(session: SessionHandle): Promise<void> {
    if (!session.setAutoCompactionEnabled) {
      return;
    }
    const resolved = await this.resolveAutoCompaction(session.id);
    session.setAutoCompactionEnabled(resolved.enabled);
  }

  /**
   * Plan execution seam: send a prompt to a session for inline execution
   * or final verification. Uses the existing session/prompt path.
   */
  private async promptPlanSession(
    sessionId: string,
    text: string,
    parentRunId?: string,
  ): Promise<{ runId: string; finalAssistantMessageId: string }> {
    const operation = () =>
      this.handleCommand({
        type: 'session/prompt',
        sessionId,
        input: { text },
      });
    const result = parentRunId
      ? await this.runExecutionContext.run(parentRunId, operation)
      : await operation();
    if (!result.success) {
      throw new Error(result.error);
    }
    const data = result.data as { runId?: unknown };
    if (typeof data.runId !== 'string') {
      throw new Error('session/prompt accepted without a Run id');
    }
    const terminal = await this.runRegistry.join(data.runId);
    if (!terminal) {
      throw new Error(`foreground Run disappeared: ${data.runId}`);
    }
    if (terminal.status !== 'completed') {
      throw new Error(
        terminal.error ?? `foreground Run ${data.runId} ended with ${terminal.status}`,
      );
    }
    const recorder = this.transcriptRecorders.get(sessionId);
    if (recorder) {
      await recorder.flush();
    }
    const messages = await this.loadTranscriptMessages(sessionId);
    const finalAssistant = [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'assistant' && message.runId === data.runId && message.status === 'done',
      );
    if (!finalAssistant) {
      throw new Error(`foreground Run ${data.runId} completed without a durable assistant message`);
    }
    return { runId: data.runId, finalAssistantMessageId: finalAssistant.id };
  }

  /**
   * Plan execution seam: abort a running session (parent or child).
   */
  private async abortPlanSession(sessionId: string): Promise<void> {
    await this.handleCommand({
      type: 'session/abort',
      sessionId,
    });
  }

  private async ensureTranscriptRecorder(
    sessionId: string,
    projectPath: string,
    runtimeGenerationId: string,
  ): Promise<void> {
    if (this.transcriptRecorders.has(sessionId)) {
      return;
    }
    const store = await this.transcriptStores.get(sessionId, projectPath);
    this.transcriptRecorders.set(
      sessionId,
      createStoreTranscriptRecorder({
        store,
        runtimeGenerationId,
        resolveModel: () => this.sessionModels.get(sessionId),
        onDiagnostic: (message) =>
          this.push({ type: 'host/log', level: 'warn', message: `[transcript] ${message}` }),
      }),
    );
  }

  private async recordUserPrompt(sessionId: string, input: PromptInput): Promise<void> {
    const projectPath = this.sessionProjects.get(sessionId) ?? 'unknown';
    const runtimeGenerationId = this.runtimeController.getStatus(sessionId).generationId;
    if (runtimeGenerationId === undefined) {
      // A cold prompt is durably accepted before runtime admission. User rows
      // own Host provenance and therefore do not require a Pi generation.
      const clientMessageId = input.clientMessageId?.trim();
      const userId =
        clientMessageId && clientMessageId.length > 0
          ? clientMessageId
          : `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const attachments = input.attachments?.filter(
        (attachment): attachment is MediaAttachmentRef => attachment.kind === 'media',
      );
      const result = await this.withTranscriptStore(
        sessionId,
        (store) =>
          store.appendMessage({
            id: userId,
            runtimeGenerationId: USER_AUTHORED_GENERATION,
            backendMessageId: userId,
            role: 'user',
            text: input.text,
            status: 'done',
            createdAt: new Date().toISOString(),
            ...(attachments !== undefined && attachments.length > 0 ? { attachments } : {}),
          }),
        projectPath,
      );
      if (!result.ok) {
        throw new Error(`Cold prompt transcript identity collision: ${userId}`);
      }
    } else {
      await this.ensureTranscriptRecorder(sessionId, projectPath, runtimeGenerationId);
      const recorder = this.transcriptRecorders.get(sessionId);
      if (recorder) {
        await recorder.recordUserPrompt(input);
      }
    }
    // Await text naming so name-updated is ordered with the user turn and the
    // session becomes listable before the model stream starts.
    try {
      await this.maybeAssignTextNameFromPrompt(sessionId, input.text);
    } catch (error: unknown) {
      const detail = formatError(error);
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `interim session name failed: ${detail}`,
      });
    }
  }

  private async loadTranscriptMessages(sessionId: string): Promise<SessionTranscriptMessage[]> {
    return this.withTranscriptStore(sessionId, (store) => store.listTail(100));
  }

  private async getTranscriptStore(
    sessionId: string,
    projectPathOverride?: string,
  ): Promise<SessionTranscriptStore> {
    const projectPath = projectPathOverride ?? this.sessionProjects.get(sessionId);
    if (projectPath !== undefined) {
      return this.transcriptStores.get(sessionId, projectPath);
    }
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
    if (record === undefined) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return this.transcriptStores.get(sessionId, record.projectPath);
  }

  private async withTranscriptStore<T>(
    sessionId: string,
    operation: (store: SessionTranscriptStore) => Promise<T>,
    projectPathOverride?: string,
  ): Promise<T> {
    const projectPath = projectPathOverride ?? this.sessionProjects.get(sessionId);
    const resolvedProjectPath =
      projectPath ??
      (
        await getSessionRecord(
          getPiwinSessionIndexPath(getPiwinRoot(this.options.piwinRoot)),
          sessionId,
        )
      )?.projectPath;
    if (resolvedProjectPath === undefined) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return this.transcriptStores.withStore(
      sessionId,
      resolvedProjectPath,
      operation,
      (candidateSessionId) =>
        this.sessions.has(candidateSessionId) || this.transcriptRecorders.has(candidateSessionId),
    );
  }

  private async touchSession(sessionId: string, preview: string): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const current = await getSessionRecord(indexPath, sessionId);
    if (current) {
      current.updatedAt = new Date().toISOString();
      current.messageCount += 1;
      current.lastPreview = preview.slice(0, 160);
      await upsertSessionRecord(indexPath, current);
      return;
    }
    const projectPath = this.sessionProjects.get(sessionId) ?? 'unknown';
    const record = createSessionRecord({
      id: sessionId,
      projectPath,
      // Leave unnamed; first-prompt text naming fills the list title.
    });
    record.messageCount = 1;
    record.lastPreview = preview.slice(0, 160);
    await upsertSessionRecord(indexPath, record);
  }

  /**
   * Drop run-correlation state after truncate/dispose so a rebuilt shell does
   * not inherit stale ownership from an aborted live handle.
   */
  private resetSessionEventState(sessionId: string): void {
    this.runEventCorrelator.clear(sessionId);
  }

  /**
   * Naming pipeline step 1 (immediate): first user message → truncated text
   * title so the session becomes listable without waiting on the model.
   * Step 2 (LLM upgrade) runs from maybeTriggerAutoName after completed turns.
   */
  private async maybeAssignTextNameFromPrompt(sessionId: string, text: string): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, sessionId);
    if (!record) {
      return;
    }
    // Never overwrite user renames, LLM titles, prior text names, or legacy auto.
    if (
      record.nameSource === 'user' ||
      record.nameSource === 'llm' ||
      record.nameSource === 'text' ||
      (record.nameSource as string | undefined) === 'auto'
    ) {
      return;
    }
    if (!isPlaceholderSessionName(record.name)) {
      return;
    }
    const interimName = deriveDefaultNameFromMessage(text);
    if (!interimName) {
      return;
    }
    const updated = await setSessionAutoName(indexPath, sessionId, interimName, 'text');
    if (updated) {
      this.push({
        type: 'session/name-updated',
        sessionId,
        name: updated.name ?? interimName,
        nameSource: 'text',
      });
    }
  }

  /**
   * CE-NAME: auto-name after each completed exchange until a terminal name
   * (`llm` or `user`) lands.
   */
  private async maybeTriggerAutoName(sessionId: string): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, sessionId);
    if (!record) {
      return;
    }
    // messageCount counts completed runs (touchSession += 1 per run), so a
    // value >= 1 means at least one exchange is finished. We attempt naming on
    // every completed exchange; a failure leaves nameSource as 'default', so
    // the next exchange retries until naming succeeds.
    // `user` (manual) and `llm` (generated) names are terminal for auto-naming.
    // A `text` fallback may still be upgraded to an LLM title on a later
    // completed exchange. messageCount is best-effort (touchSession); still
    // attempt when the session is only text-named so a failed touch cannot
    // block the model title forever.
    if (record.nameSource === 'user' || record.nameSource === 'llm') {
      return;
    }
    if (record.messageCount < 1 && record.nameSource !== 'text') {
      return;
    }
    // Read the transcript instead of in-memory maps: the maps drift when the
    // first exchange fails to name (a later retry would see a later prompt
    // instead of the first user message) and are empty after a host restart.
    const store = await this.getTranscriptStore(sessionId);
    const firstUserMessage = await store.firstMessageByRole('user');
    if (!firstUserMessage?.text) {
      return;
    }
    const lastAssistantMessage = await store.lastMessageByRole('assistant');
    const assistantReply = lastAssistantMessage?.text ?? '';
    // Prefer the model snapshot from the transcript; fall back to the last
    // prompt's model for legacy transcripts that omit it.
    const modelRef = lastAssistantMessage?.model ?? this.sessionModels.get(sessionId);
    const config = await loadPiwinConfig(rootDir);
    await maybeAutoNameSession({
      piwinRoot: this.options.piwinRoot ?? rootDir,
      sessionId,
      firstMessage: firstUserMessage.text,
      ...(assistantReply ? { assistantReply } : {}),
      ...(modelRef ? { modelRef } : {}),
      providers: getEnabledProviders(config),
      secretResolver: createSecretResolver(),
      push: (message) => this.push(message),
    });
  }

  /**
   * ADR 0040 §7: activation is Host-owned and deduplicated by session id.
   * Returns the resident handle, creating a fresh runtime generation for the
   * stable product session id when the session is cold. A second concurrent
   * activation for the same session shares the in-flight transition.
   */
  private activateSessionRuntime(
    sessionId: string,
    runId?: string,
    signal?: AbortSignal,
  ): Promise<SessionHandle> {
    const suspension = this.sessionSuspensionPromises.get(sessionId);
    if (suspension) {
      return suspension.then(() => this.activateSessionRuntime(sessionId, runId, signal));
    }
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return Promise.resolve(existing);
    }
    const inFlight = this.sessionActivationPromises.get(sessionId);
    if (inFlight) {
      return inFlight;
    }
    const activation = this.doActivateSessionRuntime(sessionId, runId, signal).finally(() => {
      this.sessionActivationPromises.delete(sessionId);
    });
    this.sessionActivationPromises.set(sessionId, activation);
    return activation;
  }

  private async doActivateSessionRuntime(
    sessionId: string,
    runId?: string,
    signal?: AbortSignal,
  ): Promise<SessionHandle> {
    // 1. validate the durable session record before allocating any runtime.
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, sessionId);
    if (!record) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    // 2. reserve residency capacity (ADR 0040 §4). Admission evicts idle
    // runtimes first (with the aggregate Host/worker RSS sample); a
    // busy-only budget queues a cancellable waiter.
    const runtimeGenerationId = createRuntimeGenerationId();
    await this.refreshWorkerRssSample();
    const admissionPromise = this.residencyController.beginActivation(
      sessionId,
      runtimeGenerationId,
      signal ?? new AbortController().signal,
    );
    // While the activation queues for capacity, publish waiting-resource so
    // clients see the constraint instead of silence (ADR 0040 §4).
    if (runId !== undefined) {
      void this.publishWaitingResourceWhileQueued(runId);
    }
    const admission = await admissionPromise;
    if (!admission.ok) {
      if (admission.code === 'memory-pressure') {
        const memoryError = new Error(`runtime-memory-pressure: ${admission.message}`);
        (memoryError as { code?: string }).code = 'runtime-memory-pressure';
        throw memoryError;
      }
      throw new Error(`activation aborted: ${admission.message}`);
    }
    let handle: SessionHandle;
    try {
      // 3. create and commit a generation for the same product session id.
      handle = await this.host.activateSession(
        sessionId,
        {
          projectPath: record.projectPath,
          ...(record.name ? { sessionName: record.name } : {}),
        },
        runtimeGenerationId,
      );
      if (runId !== undefined) {
        const attached = this.runRegistry.attachRuntimeGeneration(runId, runtimeGenerationId);
        if (!attached.ok) {
          await this.host.dropSession(sessionId);
          this.residencyController.abortActivation(sessionId, runtimeGenerationId);
          throw new Error(
            `cold activation generation attach failed for ${sessionId}: ` +
              `${runId} -> ${runtimeGenerationId} (${attached.reason})`,
          );
        }
      }
    } catch (error) {
      this.residencyController.abortActivation(sessionId, runtimeGenerationId);
      const message = formatError(error);
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `session activation failed for ${sessionId}: ${message}`,
      });
      throw error;
    }
    try {
      // 4. bind the event stream and recorder with the attached generation.
      await this.bindSession(
        handle,
        record.projectPath,
        record.name,
        undefined,
        runtimeGenerationId,
      );
    } catch (error) {
      const unsubscribe = this.unsubscribers.get(sessionId);
      unsubscribe?.();
      this.unsubscribers.delete(sessionId);
      this.sessions.delete(sessionId);
      this.sessionProjects.delete(sessionId);
      const recorder = this.transcriptRecorders.get(sessionId);
      recorder?.dispose();
      this.transcriptRecorders.delete(sessionId);
      await this.host.dropSession(sessionId).catch((dropError: unknown) => {
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `failed to drop unbound runtime for ${sessionId}: ${formatError(dropError)}`,
        });
      });
      this.residencyController.abortActivation(sessionId, runtimeGenerationId);
      const message = formatError(error);
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `session bind failed for ${sessionId}: ${message}`,
      });
      throw error;
    }
    this.residencyController.commitActivation(sessionId, runtimeGenerationId);
    if (runId !== undefined) {
      this.residencyController.markBusy(sessionId, runtimeGenerationId);
    }
    // A reconstructed backend owns no native Pi context: the first prompt must
    // inject bounded product history exactly once for this generation.
    this.coldStartHistoryBySession.set(sessionId, runtimeGenerationId);
    return handle;
  }

  /** Generation id awaiting its first product-history injection, if any. */
  private pendingColdStartGenerationId(sessionId: string): string | undefined {
    const pendingGeneration = this.coldStartHistoryBySession.get(sessionId);
    if (pendingGeneration === undefined) {
      return undefined;
    }
    return this.runtimeController.getStatus(sessionId).generationId === pendingGeneration
      ? pendingGeneration
      : undefined;
  }

  /**
   * ADR 0040 §8: refresh the cached aggregate worker RSS sample with a short
   * throttle. Runs before admission so the eviction decision sees current
   * Host + worker RSS; a missing/partial sample never makes a false
   * low-memory claim (count/TTL enforcement still applies).
   */
  private async refreshWorkerRssSample(force = false): Promise<void> {
    const supervisor = this.agentWorkerSupervisor;
    if (!supervisor) {
      this.workerRssSample = null;
      return;
    }
    if (
      !force &&
      this.workerRssSample !== null &&
      Date.now() - this.workerRssSample.sampledAtMs < 1000
    ) {
      return;
    }
    try {
      const sample = await supervisor.sampleAggregateWorkerRssMiB();
      this.workerRssSample = {
        rssMiB: sample.rssMiB,
        completeness: sample.sampleCompleteness,
        sampledAtMs: Date.now(),
      };
    } catch {
      this.workerRssSample = { rssMiB: 0, completeness: 'missing', sampledAtMs: Date.now() };
    }
  }

  /**
   * ADR 0040 §4: publish `waiting-resource` while an activation queues for
   * capacity. Bounded poll (1s) — if admission resolves first, the phase was
   * never queued and no phase is emitted.
   */
  private async publishWaitingResourceWhileQueued(runId: string): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (this.residencyController.getCounts().waiterCount > 0) {
        this.runRegistry.updatePhase(runId, 'waiting-resource');
        return;
      }
    }
  }

  /** Query-only aggregate residency/resource metrics (ADR 0040 §8). */
  private getRuntimeResources(): import('@piwin/contracts').HostRuntimeResourcesData {
    const counts = this.residencyController.getCounts();
    const counters = this.residencyController.getCounters();
    const maxResidentRuntimes = this.residencyController.getMaxResidentRuntimes();
    const worker = this.workerRssSample;
    return {
      counts: {
        resident: counts.resident,
        idle: counts.residentIdle,
        busy: counts.residentBusy,
        activating: counts.activating,
        suspending: counts.suspending,
      },
      waiterCount: counts.waiterCount,
      budget: {
        maxResidentRuntimes,
        maxIdleRuntimes: this.runtimeRetention.maxIdleRuntimes,
        memoryHighWaterMiB: this.runtimeMemoryHighWaterMiB,
        memoryLowWaterMiB: deriveMemoryLowWaterMiB(this.runtimeMemoryHighWaterMiB),
      },
      memory: {
        hostRssMiB: Math.max(1, Math.round(process.memoryUsage().rss / 1024 / 1024)),
        ...(worker && worker.rssMiB > 0 ? { workerRssMiB: worker.rssMiB } : {}),
        sampleCompleteness: worker?.completeness ?? 'missing',
      },
      counters: {
        evictedByIdleTtl: counters.evictedByIdleTtl,
        evictedByMaxIdle: counters.evictedByMaxIdle,
        evictedByMaxResident: counters.evictedByMaxResident,
        evictedByMemoryPressure: counters.evictedByMemoryPressure,
        memoryPressureFailures: counters.memoryPressureFailures,
      },
    };
  }

  /**
   * ADR 0040 §5: a session runtime is never an eviction candidate while any
   * protected work is in flight — an active/cancelling Run (or a
   * generation-correlated descendant), a pending permission or Extension UI
   * request, a compaction or replacement transaction, or an activation
   * transition already in progress.
   */
  private isSessionRuntimeProtected(sessionId: string): boolean {
    const generationId = this.runtimeController.getStatus(sessionId).generationId;
    const hasActiveRun = this.runRegistry
      .list({ status: ['queued', 'running', 'cancelling'] })
      .some(
        (run) =>
          run.sessionId === sessionId ||
          (generationId !== undefined && run.runtimeGenerationId === generationId),
      );
    if (hasActiveRun) {
      return true;
    }
    if ([...this.pendingPermissions.values()].some((request) => request.sessionId === sessionId)) {
      return true;
    }
    if ([...this.pendingExtensionUi.values()].some((request) => request.sessionId === sessionId)) {
      return true;
    }
    if (this.residencyController.isProtected(sessionId)) {
      return true;
    }
    if (this.runtimeReplacementEngine.hasPending(sessionId)) {
      return true;
    }
    if (this.sessionActivationPromises.has(sessionId)) {
      return true;
    }
    return false;
  }

  /**
   * ADR 0040 §6: suspension is separate from session disposal. Executes the
   * full cleanup transaction while the residency entry remains `suspending`.
   * Capacity is released only after this returns true. The transaction is
   * idempotent and never touches independent authorities
   * (Jobs, walkthrough generation, durable session data).
   */
  private suspendSessionRuntime(
    sessionId: string,
    runtimeGenerationId: string,
    reason: import('@piwin/contracts').SessionRuntimeEvictionReason,
  ): Promise<boolean> {
    const existing = this.sessionSuspensionPromises.get(sessionId);
    if (existing) {
      return existing;
    }
    const suspension = this.doSuspendSessionRuntime(sessionId, runtimeGenerationId, reason).finally(
      () => {
        if (this.sessionSuspensionPromises.get(sessionId) === suspension) {
          this.sessionSuspensionPromises.delete(sessionId);
        }
      },
    );
    this.sessionSuspensionPromises.set(sessionId, suspension);
    return suspension;
  }

  private async doSuspendSessionRuntime(
    sessionId: string,
    runtimeGenerationId: string,
    reason: import('@piwin/contracts').SessionRuntimeEvictionReason,
  ): Promise<boolean> {
    const live = this.sessions.get(sessionId);
    if (!live) {
      return true;
    }
    // Recheck blockers: state may have changed since the sweep decision.
    if (this.isSessionRuntimeProtected(sessionId)) {
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `[residency] suspension deferred for ${sessionId}: protected work in flight`,
      });
      return false;
    }
    // Flush is the final reversible step. Once ProductAgentHost detaches the
    // generation, restoring resident-idle would publish a dead handle.
    const recorder = this.transcriptRecorders.get(sessionId);
    if (recorder) {
      try {
        await recorder.flush();
      } catch (error) {
        const detail = formatError(error);
        this.push({
          type: 'host/log',
          level: 'error',
          message: `[residency] suspension aborted for ${sessionId}: recorder flush failed: ${detail}`,
        });
        return false;
      }
    }

    const cleanupErrors: unknown[] = [];
    try {
      await this.host.dropSession(sessionId);
    } catch (error) {
      // ProductAgentHost still attempts generation detach, abort, and backend
      // release before surfacing its AggregateError. Cleanup below must finish
      // the Host projection as cold; the detached runtime cannot be rolled back.
      cleanupErrors.push(error);
    }
    const generationStillAttached =
      this.runtimeController.getStatus(sessionId).generationId === runtimeGenerationId;
    if (generationStillAttached) {
      const detail = cleanupErrors.map((error) => formatError(error)).join('; ');
      this.push({
        type: 'host/log',
        level: 'error',
        message: `[residency] suspension failed before detach for ${sessionId} (${reason}): ${detail || 'generation remained attached'}`,
      });
      return false;
    }

    await this.refreshWorkerRssSample(true);
    const unsub = this.unsubscribers.get(sessionId);
    if (unsub) {
      try {
        unsub();
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        this.unsubscribers.delete(sessionId);
      }
    }
    this.runEventCorrelator.clear(sessionId);
    this.sessions.delete(sessionId);
    this.coldStartHistoryBySession.delete(sessionId);
    if (recorder) {
      try {
        recorder.dispose();
      } catch (error) {
        cleanupErrors.push(error);
      } finally {
        this.transcriptRecorders.delete(sessionId);
      }
    }
    try {
      this.transcriptStores.close(sessionId);
    } catch (error) {
      cleanupErrors.push(error);
    }
    // Remove resident-only maps.
    this.sessionProjects.delete(sessionId);
    this.sessionModels.delete(sessionId);
    this.sessionLastAssistantReply.delete(sessionId);
    this.sessionUsage.delete(sessionId);
    this.sessionLastPromptText.delete(sessionId);
    this.sessionAutoCompactionOverrides.delete(sessionId);
    this.sessionFilesTouched.delete(sessionId);
    this.sideChatSnapshotInjectedVersions.delete(sessionId);
    this.clearSessionAllowlist(sessionId);
    this.sessionPermissionOverrides.delete(sessionId);
    this.runtimeController.markCold(sessionId, reason);
    if (cleanupErrors.length > 0) {
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `[residency] ${sessionId} became cold with cleanup errors: ${cleanupErrors.map((error) => formatError(error)).join('; ')}`,
      });
    }
    return true;
  }

  private async ensureLiveSession(sessionId: string): Promise<SessionHandle> {
    return this.activateSessionRuntime(sessionId);
  }

  private async recordUsageToLedger(sessionId: string, usage: ContextUsageSnapshot): Promise<void> {
    const totalTokens = usage.totalTokens ?? usage.tokensUsed;
    if (totalTokens === undefined || !Number.isFinite(totalTokens)) {
      return;
    }
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const ledgerPath = getPiwinUsageLedgerPath(rootDir);
    const projectPath = this.sessionProjects.get(sessionId) ?? '';
    const modelRef = this.sessionModels.get(sessionId);
    const modelId = usage.modelId ?? modelRef?.modelId;
    const record: UsageRecord = {
      sessionId,
      projectPath: projectPath.trim().length > 0 ? projectPath : null,
      ...(modelRef?.providerId ? { providerId: modelRef.providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(usage.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
      ...(usage.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
      ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
      ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
      ...(usage.durationMs !== undefined ? { durationMs: usage.durationMs } : {}),
      totalTokens,
      source: usage.source === 'host-estimate' ? 'host-estimate' : 'assistant-usage',
      recordedAt: new Date().toISOString(),
    };
    try {
      await appendUsageRecord(ledgerPath, record);
    } catch (error) {
      const message = formatError(error);
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `usage ledger write failed: ${message}`,
      });
    }
  }

  private async loadSessionUsage(sessionId: string): Promise<ContextUsageSnapshot | null> {
    const cached = this.sessionUsage.get(sessionId);
    if (cached) {
      return cached;
    }
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const restored = await readLatestSessionContextUsage(
      getPiwinUsageLedgerPath(rootDir),
      sessionId,
    );
    if (restored) {
      this.sessionUsage.set(sessionId, restored);
    }
    return restored;
  }

  private async maybeEmitUsageOnMessageEnd(sessionId: string, messageId: string): Promise<void> {
    const existing = this.sessionUsage.get(sessionId);
    if (existing && existing.source !== 'host-estimate') {
      return;
    }
    if (existing && existing.updatedAt) {
      const ageMs = Date.now() - Date.parse(existing.updatedAt);
      if (Number.isFinite(ageMs) && ageMs < 2000) {
        return;
      }
    }
    try {
      const message = await (await this.getTranscriptStore(sessionId)).getMessage(messageId);
      if (!message || message.role !== 'assistant') {
        return;
      }
      const promptText = this.sessionLastPromptText.get(sessionId) ?? '';
      // Fallback estimate: assistant message end minus transcript creation is a
      // loose end-to-end turn duration; cap it so stale transcripts never
      // poison tok/s with an unbounded span.
      let estimatedDurationMs: number | undefined;
      const createdAt = Date.parse(message.createdAt ?? '');
      if (Number.isFinite(createdAt)) {
        const ageMs = Date.now() - createdAt;
        if (ageMs > 0 && ageMs <= 30 * 60 * 1000) {
          estimatedDurationMs = ageMs;
        }
      }
      const usage = estimateMockUsage(sessionId, promptText, message.text, estimatedDurationMs);
      const currentUsage = this.sessionUsage.get(sessionId);
      if (!shouldAcceptContextUsage(currentUsage, usage)) {
        return;
      }
      this.sessionUsage.set(sessionId, usage);
      void this.recordUsageToLedger(sessionId, usage);
      this.push({
        type: 'event',
        sessionId,
        event: { type: 'usage/update', sessionId, usage },
      });
    } catch {
      // best-effort
    }
  }

  private async abortLiveSession(sessionId: string): Promise<void> {
    this.settlePendingExtensionUiForSession(sessionId);
    const live = this.sessions.get(sessionId);
    if (!live) {
      return;
    }
    try {
      await live.abort();
    } catch {
      // best-effort
    }
    // Stop any Jobs associated with this session (ADR 0030 lifecycle).
    await this.stopProcessesForSession(sessionId);
  }

  private async disposeLiveSession(
    sessionId: string,
    reason: import('@piwin/contracts').SessionRuntimeEvictionReason = 'host-dispose',
  ): Promise<void> {
    this.settlePendingExtensionUiForSession(sessionId);
    const replacementCleanup = this.runtimeReplacementEngine.cancel(sessionId);
    const live = this.sessions.get(sessionId);
    const activeRun = this.runRegistry.getForegroundRun(sessionId);
    if (activeRun) {
      // Abort can synchronously produce provider events; close ownership
      // before invoking it so explicit old-run events are rejected.
      this.runRegistry.requestCancel(activeRun.runId, 'session-disposed');
      this.runEventCorrelator.markRunTerminal(sessionId, activeRun.runId);
    }
    if (live) {
      try {
        await live.abort();
      } catch {
        // best-effort
      }
    }
    await replacementCleanup;
    this.sessions.delete(sessionId);
    const unsub = this.unsubscribers.get(sessionId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(sessionId);
    }
    this.sessionProjects.delete(sessionId);
    this.sessionModels.delete(sessionId);
    this.sessionLastAssistantReply.delete(sessionId);
    const recorder = this.transcriptRecorders.get(sessionId);
    if (recorder) {
      try {
        await recorder.flush();
      } catch {
        // best-effort
      }
      recorder.dispose();
      this.transcriptRecorders.delete(sessionId);
    }
    this.transcriptStores.close(sessionId);
    this.resetSessionEventState(sessionId);
    // ADR 0040 §6: session disposal also releases the residency entry so the
    // sweep timer and counters never track a disposed runtime. Read the
    // generation BEFORE detaching it from the runtime registry.
    const disposedGenerationId = this.runtimeController.getStatus(sessionId).generationId;
    this.pendingDirectActivations.delete(sessionId);
    this.runtimeController.detachGeneration(sessionId);
    if (disposedGenerationId !== undefined) {
      this.residencyController.beginSuspend(sessionId, disposedGenerationId, reason);
      this.residencyController.finishSuspend(sessionId, disposedGenerationId);
    }
    this.runtimeController.markCold(sessionId, reason);
    this.sessionHostToolPort?.clearSession(sessionId);
    this.clearSessionAllowlist(sessionId);
    this.sessionUsage.delete(sessionId);
    this.sessionLastPromptText.delete(sessionId);
    this.sessionAutoCompactionOverrides.delete(sessionId);
    this.sessionFilesTouched.delete(sessionId);
    await this.host.dropSession(sessionId);
    // §11.3: abort in-flight walkthrough generations for the disposed session.
    this.walkthroughRegistry.abortSession(sessionId);
    // ADR 0030 Phase B: stop session-lifetime Jobs when the session is disposed.
    await this.stopProcessesForSession(sessionId);
  }

  /**
   * Remove a non-responsive runtime from product authority synchronously.
   * Backend cleanup is generation-scoped and deliberately detached so a
   * stuck Pi abort cannot keep the Run/UI or the next activation blocked.
   */
  private quarantineSessionRuntime(sessionId: string, runId: string): void {
    const run = this.runRegistry.get(runId);
    if (!run || run.sessionId !== sessionId || !isRunTerminal(run.status)) {
      return;
    }
    const live = this.sessions.get(sessionId);
    const runtimeGenerationId =
      run.runtimeGenerationId ?? this.runtimeController.getStatus(sessionId).generationId;

    this.runEventCorrelator.markRunTerminal(sessionId, runId);
    if (live) {
      this.sessions.delete(sessionId);
      this.host.detachSessionHandle(sessionId, live);
    }
    const unsubscribe = this.unsubscribers.get(sessionId);
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch (error) {
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `quarantined session unsubscribe failed: ${formatError(error)}`,
        });
      }
      this.unsubscribers.delete(sessionId);
    }

    const recorder = this.transcriptRecorders.get(sessionId);
    if (recorder) {
      this.transcriptRecorders.delete(sessionId);
      void (async () => {
        try {
          await recorder.flush();
        } catch (error) {
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `quarantined transcript flush failed: ${formatError(error)}`,
          });
        } finally {
          try {
            recorder.dispose();
          } catch (error) {
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `quarantined transcript dispose failed: ${formatError(error)}`,
            });
          }
        }
      })();
    }

    this.coldStartHistoryBySession.delete(sessionId);
    this.pendingDirectActivations.delete(sessionId);
    this.runtimeController.detachGeneration(sessionId);
    if (runtimeGenerationId !== undefined) {
      const suspension = this.residencyController.beginSuspend(
        sessionId,
        runtimeGenerationId,
        'manual',
      );
      if (suspension.ok) {
        this.residencyController.finishSuspend(sessionId, runtimeGenerationId);
      }
    }
    this.runtimeController.markCold(sessionId, 'manual');
    this.sessionHostToolPort?.clearSession(sessionId);

    if (runtimeGenerationId !== undefined) {
      void this.releaseQuarantinedRuntime(sessionId, runtimeGenerationId).catch((error: unknown) => {
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `quarantined runtime cleanup failed: ${formatError(error)}`,
        });
      });
    }
  }

  private async releaseQuarantinedRuntime(
    sessionId: string,
    runtimeGenerationId: string,
  ): Promise<void> {
    const cleanupResults = await Promise.allSettled([
      this.host.releaseSessionGeneration(sessionId, runtimeGenerationId),
      this.releaseGenerationToolSurface(sessionId, runtimeGenerationId),
    ]);
    const failures = cleanupResults.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.reason),
        `failed to release quarantined runtime ${sessionId}/${runtimeGenerationId}`,
      );
    }
  }

  private requireSession(sessionId: string): SessionHandle {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private async createSession(
    input: CreateSessionInput,
    options: CreateSessionOptions = {},
  ): Promise<SessionHandle> {
    switch (this.options.testFixture) {
      case 'hang-until-abort':
        return createDelayedSessionHandle({
          ...(input.projectPath ? { projectPath: input.projectPath } : {}),
          delays: { firstTokenMs: 60_000, hangUntilAbort: true, cancellationAckMs: 200 },
          chunkCount: 0,
        });
      case 'slow-first-token':
        return createDelayedSessionHandle({
          ...(input.projectPath ? { projectPath: input.projectPath } : {}),
          delays: { firstTokenMs: 750 },
          chunkCount: 1,
        });
      case 'high-rate-tool-output':
        return createDelayedSessionHandle({
          ...(input.projectPath ? { projectPath: input.projectPath } : {}),
          chunkCount: 1,
          toolOutputBytes: 10 * 1024 * 1024,
          toolOutputChunkBytes: 64 * 1024,
        });
      case undefined: {
        // Mock hosts expose no `browser_*` tools. Real hosts need the passive
        // BrowserSession service registered before the Pi session so the tools
        // appear; creating/subscribing it does not launch Chromium (ADR 0020).
        // Best-effort: service initialization failure must not block session
        // creation — the tools simply will not appear.
        if (this.options.mock !== true) {
          try {
            await this.ensureBrowserSession();
          } catch (error) {
            const detail = formatError(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `browser session init failed: ${detail}`,
            });
          }
        }
        const sessionId = createProductSessionId();
        const runtimeGenerationId = createRuntimeGenerationId();
        await this.refreshWorkerRssSample();
        const admission = await this.residencyController.beginActivation(
          sessionId,
          runtimeGenerationId,
          new AbortController().signal,
        );
        if (!admission.ok) {
          const error = new Error(
            admission.code === 'memory-pressure'
              ? `runtime-memory-pressure: ${admission.message}`
              : `activation aborted: ${admission.message}`,
          );
          (error as { code?: string }).code =
            admission.code === 'memory-pressure' ? 'runtime-memory-pressure' : admission.code;
          throw error;
        }
        this.pendingDirectActivations.set(sessionId, runtimeGenerationId);
        try {
          // Direct create and cold activation share the same stable-identity
          // backend path. The reservation remains `activating` until bindSession
          // has installed the recorder/subscription and publishes the handle.
          return await this.host.activateSession(sessionId, input, runtimeGenerationId, options);
        } catch (error) {
          this.pendingDirectActivations.delete(sessionId);
          this.residencyController.abortActivation(sessionId, runtimeGenerationId);
          throw error;
        }
      }
      default:
        throw new Error(`Unsupported host test fixture: ${this.options.testFixture}`);
    }
  }

  private async compileRuntimeCandidate(
    sessionId: string,
    generationId: string,
    expectedSettingsRevision: string,
  ): Promise<RuntimeReplacementCandidate> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
    if (!record) throw new Error(`Unknown session: ${sessionId}`);
    const input: CreateSessionInput = { projectPath: record.projectPath };
    if (record.scope !== undefined) input.scope = record.scope;
    if (record.workingDirectory !== undefined) input.cwd = record.workingDirectory;
    if (record.name !== undefined) input.sessionName = record.name;
    const model = this.sessionModels.get(sessionId);
    if (model !== undefined) input.model = model;
    const prepared = await this.host.prepareSession(sessionId, input, generationId);
    this.preparedRuntimeGenerations.set(`${sessionId}\u0000${generationId}`, prepared);
    if (prepared.settingsRevision !== expectedSettingsRevision) {
      await this.abortRuntimeGeneration(sessionId, generationId);
      throw new Error('runtime-reload-revision-mismatch');
    }
    return { generationId, settingsRevision: prepared.settingsRevision };
  }

  private async disposeRuntimeGeneration(sessionId: string, generationId: string): Promise<void> {
    const key = `${sessionId}\u0000${generationId}`;
    const cleanupErrors: unknown[] = [];
    const retiredSession = this.retiredRuntimeSessions.get(key);
    if (retiredSession) {
      try {
        await retiredSession.abort();
      } catch (error) {
        cleanupErrors.push(error);
      }
      this.retiredRuntimeSessions.delete(key);
    }
    try {
      await this.host.releaseSessionGeneration(sessionId, generationId);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await this.mcpManager?.releaseGenerationSnapshot(
        this.generationMcpSnapshots.get(key)?.generationId ?? key,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
    this.sessionHostToolPort?.discardRetiredGeneration(sessionId, generationId);
    this.clearGenerationToolSurface(sessionId, generationId);
    for (const error of cleanupErrors) {
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `retired runtime generation cleanup failed for ${sessionId}/${generationId}: ${formatUnknownError(error)}`,
      });
    }
  }

  private async createRuntimeGeneration(
    sessionId: string,
    candidate: RuntimeReplacementCandidate,
  ): Promise<void> {
    const key = `${sessionId}\u0000${candidate.generationId}`;
    const prepared = this.preparedRuntimeGenerations.get(key);
    if (!prepared) {
      throw new Error(`runtime-reload-candidate-not-prepared: ${key}`);
    }
    const previousSession = this.sessions.get(sessionId);
    const oldGenerationId = this.runtimeController.getStatus(sessionId).generationId;
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
    if (!record) {
      throw new Error(`Unknown session: ${sessionId}`);
    }

    let promoted = false;
    try {
      if (
        this.sessionHostToolPort &&
        !this.sessionHostToolPort.commitPendingGeneration(sessionId, candidate.generationId)
      ) {
        throw new Error(`runtime-reload-pending-surface-missing: ${key}`);
      }
      promoted = this.sessionHostToolPort !== null;
      const session = this.host.commitPreparedSession(prepared);
      if (previousSession && oldGenerationId) {
        this.retiredRuntimeSessions.set(`${sessionId}\u0000${oldGenerationId}`, previousSession);
      }
      await this.bindSession(
        session,
        record.projectPath,
        record.name,
        undefined,
        candidate.generationId,
      );
      this.preparedRuntimeGenerations.delete(key);
    } catch (error) {
      if (promoted) {
        this.sessionHostToolPort?.rollbackCommittedGeneration(sessionId, candidate.generationId);
      }
      this.preparedRuntimeGenerations.delete(key);
      try {
        await this.host.abortPreparedSession(prepared);
      } catch (cleanupError) {
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `candidate backend cleanup failed: ${formatUnknownError(cleanupError)}`,
        });
      }
      if (previousSession && oldGenerationId) {
        this.host.restoreSession(sessionId, previousSession);
        this.sessions.set(sessionId, previousSession);
        this.retiredRuntimeSessions.delete(`${sessionId}\u0000${oldGenerationId}`);
        try {
          await this.bindSession(
            previousSession,
            record.projectPath,
            record.name,
            undefined,
            oldGenerationId,
          );
        } catch (restoreError) {
          this.push({
            type: 'host/log',
            level: 'error',
            message: `stable session binding restore failed: ${formatUnknownError(restoreError)}`,
          });
        }
      }
      throw error;
    }
  }

  private async rollbackRuntimeGeneration(sessionId: string, generationId: string): Promise<void> {
    const key = `${sessionId}\u0000${generationId}`;
    const prefix = `${sessionId}\u0000`;
    const currentGenerationId = this.runtimeController.getStatus(sessionId).generationId;
    let oldGenerationId =
      currentGenerationId && currentGenerationId !== generationId ? currentGenerationId : undefined;
    let oldSession = oldGenerationId
      ? this.retiredRuntimeSessions.get(`${prefix}${oldGenerationId}`)
      : undefined;
    if (!oldSession) {
      const retired = [...this.retiredRuntimeSessions.entries()].find(
        ([retiredKey]) =>
          retiredKey.startsWith(prefix) && retiredKey.slice(prefix.length) !== generationId,
      );
      if (retired) {
        oldGenerationId = retired[0].slice(prefix.length);
        oldSession = retired[1];
      }
    }
    const cleanupErrors: unknown[] = [];
    const candidateSession = this.sessions.get(sessionId);
    if (candidateSession && candidateSession !== oldSession) {
      try {
        await candidateSession.abort();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    this.sessionHostToolPort?.rollbackCommittedGeneration(sessionId, generationId);
    try {
      await this.host.releaseSessionGeneration(sessionId, generationId);
    } catch (error) {
      cleanupErrors.push(error);
    }
    try {
      await this.mcpManager?.releaseGenerationSnapshot(
        this.generationMcpSnapshots.get(key)?.generationId ?? key,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
    this.clearGenerationToolSurface(sessionId, generationId);

    if (oldSession && oldGenerationId) {
      this.host.restoreSession(sessionId, oldSession);
      this.sessions.set(sessionId, oldSession);
      this.retiredRuntimeSessions.delete(`${sessionId}\u0000${oldGenerationId}`);
      const rootDir = getPiwinRoot(this.options.piwinRoot);
      const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
      if (record) {
        try {
          await this.bindSession(
            oldSession,
            record.projectPath,
            record.name,
            undefined,
            oldGenerationId,
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    for (const error of cleanupErrors) {
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `runtime generation rollback cleanup failed for ${sessionId}/${generationId}: ${formatUnknownError(error)}`,
      });
    }
  }

  private async abortRuntimeGeneration(sessionId: string, generationId: string): Promise<void> {
    const key = `${sessionId}\u0000${generationId}`;
    this.sessionHostToolPort?.abortPendingGeneration(sessionId, generationId);
    const prepared = this.preparedRuntimeGenerations.get(key);
    this.preparedRuntimeGenerations.delete(key);
    const cleanupErrors: unknown[] = [];
    if (prepared) {
      try {
        await this.host.abortPreparedSession(prepared);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await this.mcpManager?.releaseGenerationSnapshot(
        this.generationMcpSnapshots.get(key)?.generationId ?? key,
      );
    } catch (error) {
      cleanupErrors.push(error);
    }
    this.clearGenerationToolSurface(sessionId, generationId);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        `runtime generation cleanup failed for ${sessionId}/${generationId}`,
      );
    }
  }

  private push(message: HostPush): void {
    let outgoing: HostPush = message;
    if (message.type === 'event') {
      const generator =
        this.eventEnvelopeGenerators.get(message.sessionId) ?? createEventEnvelopeGenerator();
      this.eventEnvelopeGenerators.set(message.sessionId, generator);
      const envelope: AgentEventEnvelope = generator.next(readEventRunId(message.event));
      outgoing = { ...message, envelope };
    }
    // ADR 0027: fan out to every attached sink. The legacy onPush sink is just
    // another entry in pushSinks, so the single-sink path is unchanged when no
    // remote sink is attached. Sink errors are isolated so one bad sink cannot
    // starve the local sidecar.
    for (const sink of this.pushSinks.values()) {
      try {
        sink.push(outgoing);
      } catch (error) {
        const detail = formatError(error);
        // Log to the legacy sink only, not back through the fan-out (avoid recursion).
        this.options.onPush?.({
          type: 'host/log',
          level: 'error',
          message: `push sink ${sink.id} threw: ${detail}`,
        });
      }
    }
  }

  /**
   * ADR 0027: attach a secondary push sink (e.g. a remote gateway connector).
   * The legacy local sidecar remains attached under {@link LEGACY_LOCAL_SINK_ID}.
   * Returns an unsubscribe handle.
   */
  attachPushSink(sink: PushSink): () => void {
    this.pushSinks.set(sink.id, sink);
    return () => {
      this.pushSinks.delete(sink.id);
    };
  }

  /** ADR 0027: detach a push sink by id. The legacy sink id cannot be removed. */
  detachPushSink(id: RemoteSinkId): void {
    if (id === LEGACY_LOCAL_SINK_ID) {
      return;
    }
    this.pushSinks.delete(id);
  }
}

/**
 * Extract the bash command from a parent-owned bash permission detail.
 *
 * The bash registration formats detail as `<reason>: <command>`. The command
 * is the remainder after the first `": "` separator, so a reason containing
 * `: ` cannot steal command text.
 * Returns the empty string when no separator is present (no command to
 * remember).
 */
function extractBashCommandFromDetail(detail: string): string {
  const separatorIndex = detail.indexOf(': ');
  if (separatorIndex === -1) {
    return '';
  }
  return detail.slice(separatorIndex + 2).trim();
}

function readEventRunId(event: AgentEvent): string | undefined {
  return 'runId' in event && typeof event.runId === 'string' ? event.runId : undefined;
}

function hasExplicitRunId(event: AgentEvent): boolean {
  return 'runId' in event && typeof event.runId === 'string';
}

/** Drop media attachments from the model-facing prompt (keep web-element if any). */
function stripMediaAttachments(
  input: PromptInput,
  text: string,
  other: PromptAttachment[],
): PromptInput {
  const { attachments: _removed, ...rest } = input;
  if (other.length > 0) {
    return { ...rest, text, attachments: other };
  }
  return { ...rest, text };
}

function validateMediaAttachment(
  mediaRoot: string,
  attachment: MediaAttachmentRef,
): MediaAttachmentRef {
  const path = assertInsideMediaRoot(mediaRoot, attachment.path);
  const safeAttachment: MediaAttachmentRef = {
    id: attachment.id,
    kind: 'media',
    path,
    mimeType: attachment.mimeType,
    byteSize: attachment.byteSize,
    source: attachment.source,
  };
  if (attachment.name !== undefined) {
    safeAttachment.name = attachment.name;
  }
  if (attachment.contentKind !== undefined) {
    safeAttachment.contentKind = attachment.contentKind;
  }
  if (attachment.width !== undefined) {
    safeAttachment.width = attachment.width;
  }
  if (attachment.height !== undefined) {
    safeAttachment.height = attachment.height;
  }
  return safeAttachment;
}

function isTextualAttachment(attachment: MediaAttachmentRef): boolean {
  const contentKind = attachment.contentKind ?? contentKindForMimeType(attachment.mimeType);
  return contentKind === 'text' || contentKind === 'document';
}

function applySubagentLineage(
  record: import('@piwin/contracts').SessionIndexRecord,
  lineage: SessionLineage | undefined,
): void {
  if (!lineage) {
    return;
  }
  if (lineage.subagentMode) record.subagentMode = lineage.subagentMode;
  if (lineage.subagentApplyPolicy) record.subagentApplyPolicy = lineage.subagentApplyPolicy;
  if (lineage.subagentAllowedOutputPaths) {
    record.subagentAllowedOutputPaths = [...lineage.subagentAllowedOutputPaths];
  }
  if (typeof lineage.subagentRetainWorktree === 'boolean') {
    record.subagentRetainWorktree = lineage.subagentRetainWorktree;
  }
  if (lineage.subagentRole) record.subagentRole = lineage.subagentRole;
  if (lineage.worktreePath) record.worktreePath = lineage.worktreePath;
  if (lineage.worktreeBranch) record.worktreeBranch = lineage.worktreeBranch;
  if (lineage.subagentRuntime) record.subagentRuntime = lineage.subagentRuntime;
  if (lineage.subagentLifecycle) record.subagentLifecycle = lineage.subagentLifecycle;
}

function copySubagentLineage(
  input: Parameters<typeof createSessionRecord>[0],
  lineage: SessionLineage | undefined,
): void {
  if (!lineage) {
    return;
  }
  if (lineage.subagentMode) input.subagentMode = lineage.subagentMode;
  if (lineage.subagentApplyPolicy) input.subagentApplyPolicy = lineage.subagentApplyPolicy;
  if (lineage.subagentAllowedOutputPaths) {
    input.subagentAllowedOutputPaths = [...lineage.subagentAllowedOutputPaths];
  }
  if (typeof lineage.subagentRetainWorktree === 'boolean') {
    input.subagentRetainWorktree = lineage.subagentRetainWorktree;
  }
  if (lineage.subagentRole) input.subagentRole = lineage.subagentRole;
  if (lineage.worktreePath) input.worktreePath = lineage.worktreePath;
  if (lineage.worktreeBranch) input.worktreeBranch = lineage.worktreeBranch;
  if (lineage.subagentRuntime) input.subagentRuntime = lineage.subagentRuntime;
  if (lineage.subagentLifecycle) input.subagentLifecycle = lineage.subagentLifecycle;
}

function createCancelledExtensionUiResponse(
  kind: import('@piwin/agent-host').ExtensionUiKind,
): import('@piwin/agent-host').ExtensionUiResponse {
  if (kind === 'confirm') {
    return { kind, confirmed: false };
  }
  return { kind, cancelled: true };
}

function fallbackPetSnapshot(): PetRuntimeSnapshot {
  return {
    petId: 'piwin-default',
    displayName: 'Piwin Default',
    spritesheetAbsolutePath: '',
    state: 'idle',
    fps: 6,
    cellWidth: 48,
    cellHeight: 52,
    cols: 8,
    rows: 9,
    stateRows: {
      idle: 0,
      running: 1,
      waiting: 2,
      failed: 3,
      waving: 4,
      jumping: 5,
      review: 6,
    },
  };
}

function formatUnknownError(error: unknown): string {
  return formatError(error);
}
