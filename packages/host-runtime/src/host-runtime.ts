import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
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
} from '@piwin/contracts';
import {
  createEventEnvelopeGenerator,
  estimateMockUsage,
  type ExtensionUiKind,
  type ExtensionUiResponse,
  AgentWorkerSupervisor,
  WorkerTaskRunner,
} from '@piwin/agent-host';
import { formatError,  isRunTerminal, LEGACY_LOCAL_SINK_ID } from '@piwin/contracts';
import { formatTextModelWebElementInjection } from '@piwin/contracts';
import { assertInsideMediaRoot, createMediaService } from '@piwin/media';
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
  listTranscriptMessages,
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
  truncateTranscriptFrom,
  buildProductHistoryContext,
  mergeProductHistoryIntoPrompt,
  exportTranscript,
  suggestSessionExportBasename,
  appendUsageRecord,
  createSubagentRunStore,
} from '@piwin/session';
import type {
  ContextUsageSnapshot,
  SessionPlan,
  SessionResumeData,
  SessionTranscriptMessage,
  UsageRecord,
} from '@piwin/contracts';
import { createTranscriptRecorder } from './transcript-recorder.js';
import { createDelayedSessionHandle } from './delayed-session-fixture.js';
import { createProductShellSession } from './product-shell-session.js';
import { formatPlanForModelContext } from './format-plan-context.js';
import {
  ProductAgentHost,
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
  getPiwinSessionTranscriptPath,
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

export type HostRuntimeOptions = {
  mode: HostMode;
  mock?: boolean;
  piwinRoot?: string;
  rpcCommand?: string;
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
};

export class HostRuntime {
  private readonly host: ProductAgentHost;
  private readonly sessions = new Map<string, SessionHandle>();
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
  private readonly transcriptRecorders = new Map<
    string,
    ReturnType<typeof createTranscriptRecorder>
  >();
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
  private readonly runtimeReplacementEngine: SessionRuntimeReplacementEngine;
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
          return (
            run?.status === 'running' &&
            run.sessionId === sessionId &&
            run.runtimeGenerationId === runtimeGenerationId
          );
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
        buildToolDescriptors: async (sessionId, runtimeGenerationId, mode = 'active') => {
          const tools = await this.buildSessionHostToolsForSession(
            sessionId,
            runtimeGenerationId,
            mode,
          );
          return descriptorsFromTools(tools);
        },
        buildToolFamilyIndex: async (sessionId, runtimeGenerationId, mode = 'active') => {
          const tools = await this.buildSessionHostToolsForSession(
            sessionId,
            runtimeGenerationId,
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
    await replacementCleanup;
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
      this.browserSessionUnsubscribe();
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
      unsubscribe();
    }
    this.unsubscribers.clear();
    for (const sessionId of this.sessions.keys()) {
      this.runEventCorrelator.clear(sessionId);
      this.eventEnvelopeGenerators.delete(sessionId);
    }
    this.sessions.clear();
    this.sessionProjects.clear();
    await Promise.all([...this.transcriptRecorders.values()].map((recorder) => recorder.flush()));
    this.transcriptRecorders.clear();
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
    await this.host.dispose();
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
    this.ready = false;
  }

  async handleCommand(command: HostCommand): Promise<HostResponse> {
    const requestId = typeof command.id === 'string' ? command.id : undefined;
    try {
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
      return input;
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
    const config = await loadPiwinConfig(this.options.piwinRoot);
    const primaryInput = resolvePrimaryModelInput(input, config);
    const supportsImage = primaryModelSupportsImage(primaryInput);

    if (media.length === 0) {
      return {
        ...input,
        text: [input.text, ...webInjections].filter(Boolean).join('\n\n'),
        attachments: safeAttachments,
      };
    }

    if (supportsImage) {
      // D2: native images via adapter loadPromptImages. Native text stays
      // free of absolute paths/base64; the adapter encodes attachments as
      // ImageContent parts (spec Phase 4: "Remove native path inventory").
      this.push({
        type: 'host/log',
        level: 'info',
        message: `Sending ${media.length} image(s) as native vision content to the primary model`,
      });
      return {
        ...input,
        text: [input.text, ...webInjections].filter(Boolean).join('\n\n'),
        attachments: safeAttachments,
      };
    }

    // Text-only: never pass ImageContent to the primary model.
    const mediaInjections: string[] = [];
    const delegate =
      shouldDelegateVision({
        primaryModelInput: primaryInput,
        hasMediaAttachments: true,
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
          for (const mediaAttachment of media) {
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
            [input.text, ...webInjections, ...mediaInjections].filter(Boolean).join('\n\n'),
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
    for (const mediaAttachment of media) {
      mediaInjections.push(pathInjectMediaAttachment(mediaAttachment));
    }
    return stripMediaAttachments(
      input,
      [input.text, ...webInjections, ...mediaInjections].filter(Boolean).join('\n\n'),
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
    try {
      if (job.type === 'prompt') {
        const projectPath = job.projectPath;
        if (!projectPath) {
          throw new Error('prompt cron requires projectPath');
        }
        const text = job.promptText?.trim() || job.name;
        const session = await this.host.createSession({
          projectPath,
          sessionName: `cron-${job.id.slice(0, 8)}`,
        });
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
      removeWorktree: async (worktreePath: string, parentRepoPath: string) => {
        await removeWorktree({ projectPath: parentRepoPath, worktreePath });
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
      registerTaskSession: (input) => {
        this.subagentSessionContexts.set(input.childSessionId, {
          parentSessionId: input.parentSessionId,
          runtimeGenerationId: input.runtimeGenerationId,
          workingDirectory: input.workingDirectory,
          parentRepoPath: input.workspaceLease.parentRepoPath,
        });
        return this.persistSubagentSessionStart(input).catch((error: unknown) => {
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `subagent session registration failed: ${formatError(error)}`,
          });
        });
      },
      unregisterTaskSession: async (childSessionId) => {
        this.subagentSessionContexts.delete(childSessionId);
        this.sessionHostToolPort?.clearSession(childSessionId);
        await this.releaseGenerationToolSurfaces(childSessionId);
      },
    });
  }

  private createAgentWorkerSupervisor(): AgentWorkerSupervisor {
    return new AgentWorkerSupervisor({
      onEvent: (sessionId, event) => {
        const childContext = this.subagentSessionContexts.get(sessionId);
        if (!childContext) return;
        this.push({
          type: 'subagent/stream',
          parentSessionId: childContext.parentSessionId,
          childSessionId: sessionId,
          event,
        });
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
    );
    const rulesRevision = this.generationPermissionRuleRevisions.get(
      `${input.childSessionId}\u0000${input.runtimeGenerationId}`,
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
        const preparedRequest = await this.prepareSubagentBatch({
          parentSessionId: sessionId,
          tasks: [
            {
              id: randomUUID(),
              parentSessionId: sessionId,
              task: input.task,
              ...(input.mode ? { isolationOverride: input.mode } : {}),
              ...(input.applyPolicy ? { applyPolicy: input.applyPolicy } : {}),
              ...(input.sessionName ? { sessionName: input.sessionName } : {}),
              ...(input.profileId ? { profileId: input.profileId } : {}),
              ...(input.model ? { model: input.model } : {}),
              ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
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
        return { childSessionId };
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
    mode: ProductAgentHostToolRegistrationMode = 'active',
  ): Promise<HostToolRegistration[]> {
    const surfaceKey = `${sessionId}\u0000${runtimeGenerationId}`;
    let surfacePromise = this.generationToolSurfaces.get(surfaceKey);
    if (!surfacePromise) {
      surfacePromise = this.composeSessionHostToolsForSession(sessionId, runtimeGenerationId);
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
      ...(config ? { secretResolver: createSecretResolver() } : {}),
      getBrowserSession: () => this.browserSession ?? undefined,
      getNotesServices: () => this.getNotesServices(),
      getCardStore: () => this.getCardStore(),
      onDiagnostic: ({ message }) => this.push({ type: 'host/log', level: 'warn', message }),
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
    return { tools, permissionGate };
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
      return {
        ...task,
        ...(planned.snapshot.profileId ? { profileId: planned.snapshot.profileId } : {}),
        ...(planned.snapshot.model ? { model: planned.snapshot.model } : {}),
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
   * is cheap — Chromium launches on first actual operation. Frame/state events
   * are forwarded to `this.push` so the desktop panel mirrors the agent's page.
   * Called before the first Pi session creation so `browser_*` tools register.
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
      sessionAutoCompactionOverrides: this.sessionAutoCompactionOverrides,
      unsubscribers: this.unsubscribers,
      transcriptRecorders: this.transcriptRecorders,
      push: (message) => this.push(message),
      pushStatus: () => this.pushStatus(),
      requireSession: (sessionId) => this.requireSession(sessionId),
      bindSession: (session, projectPath, sessionName, lineage) =>
        this.bindSession(session, projectPath, sessionName, lineage),
      loadTranscriptMessages: (sessionId) => this.loadTranscriptMessages(sessionId),
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
        this.sessions.get(sessionId)?.needsProductHistoryInjection?.() === true,
      ensureLiveSession: (sessionId) => this.ensureLiveSession(sessionId),
      resolveAutoCompaction: (sessionId) => this.resolveAutoCompaction(sessionId),
      buildModelPromptInput: (input, signal) => this.buildModelPromptInput(input, signal),
      validatePromptAttachments: (input) => this.validatePromptAttachments(input),
      loadConfig: () => loadPiwinConfig(this.options.piwinRoot),
      runWithContext: (runId, operation) => {
        void this.runExecutionContext.run(runId, operation);
      },
      getForegroundRun: (sessionId) => this.runRegistry.getForegroundRun(sessionId),
      registerForegroundRun: (sessionId) => {
        const generationId = this.runtimeController.getStatus(sessionId).generationId;
        return this.runRegistry.createForegroundRun(sessionId, generationId);
      },
      getRunSignal: (runId) => this.runRegistry.getSignal(runId),
      hasRunReceivedFirstToken: (runId) => this.runRegistry.hasFirstToken(runId),
      requestCancelRun: (sessionId, runId, reason) => {
        const active = this.runRegistry.getForegroundRun(sessionId);
        if (!active || (runId !== undefined && active.runId !== runId)) return undefined;
        return this.runRegistry.requestCancel(active.runId, reason);
      },
      updateRunPhase: (runId, phase, detail) => {
        this.runRegistry.updatePhase(runId, phase, detail);
      },
      terminateRun: async (sessionId, runId, outcome, code, message) => {
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
            : outcome === 'cancelled'
              ? 'run-cancelled'
              : 'failed';
        let cleanupFailed = false;
        if (this.jobController) {
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
        const effectiveCode = cleanupFailed
          ? 'job-cleanup-failed'
          : outcome === 'cancelled'
            ? 'cancelled'
            : outcome === 'completed'
              ? 'completed'
              : code === 'model-connect-timeout' ||
                  code === 'model-first-token-timeout' ||
                  code === 'model-turn-timeout' ||
                  code === 'mcp-timeout'
                ? 'timeout'
                : 'failed';
        const effectiveMessage = cleanupFailed ? (message ?? 'job cleanup failed') : message;
        const terminal = this.runRegistry.terminate(
          runId,
          effectiveOutcome,
          effectiveCode,
          effectiveMessage,
        );
        if (!terminal) return false;
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
        promptSession: (sessionId, text) => this.promptPlanSession(sessionId, text),
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
          this.runRegistry.terminate(
            runId,
            status,
            status === 'completed' ? 'completed' : 'failed',
            error,
          );
        },
        cancelPlanRun: (runId) => {
          if (runId) {
            this.subagentOrchestrator?.cancelBatchesForParentRun(runId);
            this.runRegistry.cancelRun(runId);
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
          const preparedRequest = await this.prepareSubagentBatch(request);
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
        host: this.host,
        loadTranscriptMessages: (sessionId) => this.loadTranscriptMessages(sessionId),
        abortLiveSession: (sessionId) => this.abortLiveSession(sessionId),
        disposeLiveSession: (sessionId) => this.disposeLiveSession(sessionId),
        bindSession: (session, projectPath, sessionName, lineage) =>
          this.bindSession(session, projectPath, sessionName, lineage),
        pushStatus: () => this.pushStatus(),
      },
    };
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

    this.ensureTranscriptRecorder(
      session.id,
      projectPath ?? this.sessionProjects.get(session.id) ?? 'unknown',
    );

    // Capture parent session id for subagent event forwarding (inline stream UX).
    const parentSessionId = lineage?.parentSessionId;
    const boundRuntimeGenerationId =
      bindingGenerationId ?? this.runtimeController.getStatus(session.id).generationId;

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
      this.push({ type: 'event', sessionId: session.id, event: correlatedEvent });
      // Forward child session events to parent for inline subagent stream UX.
      if (parentSessionId) {
        this.push({
          type: 'subagent/stream',
          parentSessionId,
          childSessionId: session.id,
          event: correlatedEvent,
        });
      }
      void this.ensurePetStateStore().then((store) => store.reduce(correlatedEvent));
      const eventRunId = correlatedRunId ?? activeRunId;
      if (eventRunId !== undefined) {
        this.runRegistry.noteAgentEvent(eventRunId, correlatedEvent);
      }
      if (correlatedEvent.type === 'permission/request') {
        this.push({
          type: 'permission/request',
          sessionId: session.id,
          requestId: correlatedEvent.requestId,
          action: correlatedEvent.action,
          detail: correlatedEvent.detail,
          defaultDecision: correlatedEvent.defaultDecision,
          ...(correlatedEvent.runId ? { runId: correlatedEvent.runId } : {}),
        });
      }
      if (event.type === 'usage/update') {
        this.sessionUsage.set(session.id, event.usage);
        // CE-OBS: only agent_end (assistant-usage) is a billable per-turn
        // count. pi-contextUsage is cumulative context occupancy — never sum.
        if (event.usage.source !== 'pi-contextUsage') {
          void this.recordUsageToLedger(session.id, event.usage);
        }
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
      void this.dispatchHooksForAgentEvent(session.id, correlatedEvent).catch((error: unknown) => {
        const message = formatError(error);
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `hook dispatch failed: ${message}`,
        });
      });
      const recorder = this.transcriptRecorders.get(session.id);
      if (recorder) {
        void recorder.recordEvent(correlatedEvent).catch((error: unknown) => {
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
  private async promptPlanSession(sessionId: string, text: string): Promise<void> {
    const result = await this.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text },
    });
    if (!result.success) {
      throw new Error(result.error);
    }
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

  private ensureTranscriptRecorder(sessionId: string, projectPath: string): void {
    if (this.transcriptRecorders.has(sessionId)) {
      return;
    }
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
    this.transcriptRecorders.set(
      sessionId,
      createTranscriptRecorder({
        transcriptPath,
        sessionId,
        projectPath,
        resolveModel: () => this.sessionModels.get(sessionId),
      }),
    );
  }

  private async recordUserPrompt(sessionId: string, input: PromptInput): Promise<void> {
    const projectPath = this.sessionProjects.get(sessionId) ?? 'unknown';
    this.ensureTranscriptRecorder(sessionId, projectPath);
    const recorder = this.transcriptRecorders.get(sessionId);
    if (recorder) {
      await recorder.recordUserPrompt(input);
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
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
    return listTranscriptMessages(transcriptPath);
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
    const messages = await this.loadTranscriptMessages(sessionId);
    const firstUserMessage = messages.find((message) => message.role === 'user');
    if (!firstUserMessage?.text) {
      return;
    }
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant');
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

  private async ensureLiveSession(sessionId: string): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
    if (!record) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    const messages = await this.loadTranscriptMessages(sessionId);
    try {
      const session = await this.host.resumeSession(sessionId);
      await this.bindSession(session, record.projectPath, record.name);
      return session;
    } catch {
      const shellOptions: Parameters<typeof createProductShellSession>[0] = {
        sessionId,
        projectPath: record.projectPath,
        seedMessages: messages,
        createLiveSession: async (input) => {
          return this.createSession(input);
        },
      };
      if (record.name) {
        shellOptions.sessionName = record.name;
      }
      const shell = createProductShellSession(shellOptions);
      await this.bindSession(shell, record.projectPath, record.name);
      return shell;
    }
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
    const record: UsageRecord = {
      sessionId,
      projectPath: projectPath.trim().length > 0 ? projectPath : null,
      ...(modelRef?.modelId ? { modelId: modelRef.modelId } : {}),
      ...(usage.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
      ...(usage.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
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

  private async maybeEmitUsageOnMessageEnd(sessionId: string, messageId: string): Promise<void> {
    const existing = this.sessionUsage.get(sessionId);
    if (existing && existing.updatedAt) {
      const ageMs = Date.now() - Date.parse(existing.updatedAt);
      if (Number.isFinite(ageMs) && ageMs < 2000) {
        return;
      }
    }
    try {
      const messages = await this.loadTranscriptMessages(sessionId);
      const message = messages.find((item) => item.id === messageId);
      if (!message || message.role !== 'assistant') {
        return;
      }
      const promptText = this.sessionLastPromptText.get(sessionId) ?? '';
      const usage = estimateMockUsage(sessionId, promptText, message.text);
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

  private async disposeLiveSession(sessionId: string): Promise<void> {
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
    this.resetSessionEventState(sessionId);
    this.runtimeController.detachGeneration(sessionId);
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
        // Mock hosts expose no `browser_*` tools, so eager-launching Chromium
        // (ADR 0020) here would only spawn a process nobody uses. Real hosts
        // need the browser session registered before the Pi session so the
        // tools appear. Best-effort: a launch failure must not block session
        // creation — the tools simply won't appear.
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
        return this.host.createSession(input, options);
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
  if (attachment.width !== undefined) {
    safeAttachment.width = attachment.width;
  }
  if (attachment.height !== undefined) {
    safeAttachment.height = attachment.height;
  }
  return safeAttachment;
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
