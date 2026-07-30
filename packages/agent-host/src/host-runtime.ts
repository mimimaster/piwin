import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import type {
  AgentEvent,
  AgentHost,
  CreateSessionInput,
  HostCommand,
  HostMode,
  HostPush,
  HostResponse,
  HostStatusData,
  MediaAttachmentRef,
  MediaSaveData,
  ModelRef,
  PermissionDecision,
  PermissionMode,
  PromptInput,
  SessionHandle,
  AgentEventEnvelope,
} from '@piwin/contracts';
import { formatTextModelImageInjection } from '@piwin/contracts';
import { assertInsideMediaRoot, createMediaService } from '@piwin/media';
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
  type McpLifecycleManager,
} from '@piwin/mcp';
import { createProcessRegistry, type ProcessRegistry } from '@piwin/process';
import { createGitService, createWorktree, removeWorktree, applyWorktreeToMain } from '@piwin/git';
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
import { PtyHost } from './pty-host.js';
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
  getSessionRecord,
  listTranscriptMessages,
  upsertSessionRecord,
  buildSessionOutline,
  loadSessionPlan,
  saveSessionPlan,
  clearSessionPlan,
  validateSessionPlan,
  listChildSessions,
  appendTranscriptMessage,
  buildSubagentMergeSummary,
  formatSubagentMergeCard,
  buildSubagentActivityView,
  applyPlanStepUpdate,
  applyPlanStatus,
  truncateTranscriptFrom,
  buildProductHistoryContext,
  mergeProductHistoryIntoPrompt,
  exportTranscript,
  suggestSessionExportBasename,
} from '@piwin/session';
import type {
  ContextUsageSnapshot,
  ExecutionMode,
  SessionResumeData,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import { estimateMockUsage } from './usage-map.js';
import { createTranscriptRecorder } from './transcript-recorder.js';
import { createDelayedSessionHandle } from './delayed-session-fixture.js';
import {
  buildRunPhaseEvent,
  buildRunTerminalEvent,
  createActiveRunRegistry,
  type ActiveRun,
  type ActiveRunRegistry,
} from './active-run.js';
import { createProductShellSession } from './product-shell-session.js';
import { formatPlanForModelContext } from './format-plan-context.js';
import { createAgentHost } from './create-host.js';
import { loadPiwinConfig, savePiwinConfig } from './config-store.js';
import { maybeAutoNameSession } from './session-naming-service.js';
import { createSecretResolver } from './secret-resolver.js';
import {
  getPiwinMediaDir,
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionIndexPath,
  getPiwinSessionTranscriptPath,
  getPiwinSessionPlanPath,
  getPiwinSessionDir,
} from './paths.js';
import { buildPermissionRequestContext } from './permission-context.js';
import { fail, ok } from './response-helpers.js';
import { indexRecordToSummary } from './session-summary-map.js';
import { dispatchDomainCommands } from './commands/domain-command-dispatch.js';
import {
  handleSessionLiveCommand,
  type SessionLiveContext,
} from './commands/session-live-commands.js';
import type { HostCommandContext } from './commands/host-command-context.js';
import { RunEventCorrelator } from './run-event-correlator.js';
import { createEventEnvelopeGenerator } from './event-map.js';

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
  kind?: 'main' | 'subagent';
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
};

export class HostRuntime {
  private readonly host: AgentHost;
  private readonly sessions = new Map<string, SessionHandle>();
  private readonly sessionProjects = new Map<string, string>();
  /** CE-MODE: per-session execution mode (chat strips tools). */
  private readonly sessionExecutionModes = new Map<string, ExecutionMode>();
  /** CE-OBS: last known usage snapshot per session. */
  private readonly sessionUsage = new Map<string, ContextUsageSnapshot>();
  /** Last user prompt text for host-estimate usage (mock path). */
  private readonly sessionLastPromptText = new Map<string, string>();
  /** CE-NAME: ModelRef used for the most recent prompt, for auto-naming. */
  private readonly sessionModels = new Map<string, ModelRef>();
  /** Runtime-only session override for auto-compaction (not persisted). */
  private readonly sessionAutoCompactionOverrides = new Map<string, boolean>();
  /** Serialize merge-subagent per parent session. */
  private readonly mergeLocks = new Map<string, Promise<unknown>>();
  private ptyHost: PtyHost | null = null;
  private readonly todoStore = new SessionTodoStore();
  /** CE-COMP: last files-touched block per session for prompt inject. */
  private readonly sessionFilesTouched = new Map<string, string>();
  /** ADR 0015: at most one foreground run per session. */
  private readonly activeRuns: ActiveRunRegistry = createActiveRunRegistry();
  /** Preserves the run identity across asynchronous SDK event callbacks. */
  private readonly runExecutionContext = new AsyncLocalStorage<string>();
  private readonly runEventCorrelator = new RunEventCorrelator();
  /** Host-side guard for context-owned events after terminal cleanup. */
  private readonly terminalRunIdsBySession = new Map<string, Set<string>>();
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
  private readonly pendingExtensionUi = new Map<
    string,
    {
      resolve: (response: import('./extension-ui-bridge.js').ExtensionUiResponse) => void;
      kind: import('./extension-ui-bridge.js').ExtensionUiKind;
    }
  >();
  private readonly transcriptRecorders = new Map<
    string,
    ReturnType<typeof createTranscriptRecorder>
  >();
  private mcpManager: McpLifecycleManager | null = null;
  private processRegistry: ProcessRegistry | null = null;
  private cardStore: import('@piwin/flashcards').CardStore | null = null;
  private folderRag: import('@piwin/doc-rag').FolderRag | null = null;
  private notesServices: {
    store: import('@piwin/notes').NoteStore;
    index: import('@piwin/notes').NoteIndex;
    searchOptions: import('@piwin/notes').SearchNotesOptions;
  } | null = null;
  private readonly options: HostRuntimeOptions;
  private ready = true;

  constructor(options: HostRuntimeOptions) {
    this.options = options;
    // Single process owner for Desktop UI lifecycle + SDK session tools.
    const rootDir = getPiwinRoot(options.piwinRoot);
    const mcpManager = createMcpLifecycleManager(rootDir);
    this.mcpManager = mcpManager;
    const processRegistry = createProcessRegistry({
      getTrustedProjectRoots: async () => {
        try {
          const projects = await listProjects(getPiwinProjectsPath(rootDir));
          return projects
            .filter((project) => project.trust === 'trusted')
            .map((project) => project.path);
        } catch (error) {
          // Trust DB read failure must not crash the host, but silently
          // returning [] would make all process spawns look "untrusted"
          // with no explanation. Warn so the user can diagnose.
          const detail = error instanceof Error ? error.message : String(error);
          this.push({
            type: 'host/log',
            level: 'warn',
            message: `trusted project roots read failed: ${detail}`,
          });
          return [];
        }
      },
      onEvent: (event) => this.emitProcessEvent(event),
    });
    this.processRegistry = processRegistry;
    const createOptions: Parameters<typeof createAgentHost>[0] = {
      mode: options.mode,
      mock: options.mock === true,
      onPermissionRequest: async (request) => this.requestPermission(request),
      lifecycleManager: mcpManager,
      processRegistry,
      onExtensionUiRequest: async (request) => this.requestExtensionUi(request),
      onExtensionNotify: (message, level) => {
        this.push({
          type: 'host/log',
          level: level === 'warning' ? 'warn' : level,
          message: `[extension] ${message}`,
        });
      },
      onLog: (message, level) => {
        this.push({ type: 'host/log', level, message });
      },
    };
    if (typeof options.piwinRoot === 'string') {
      createOptions.piwinRoot = options.piwinRoot;
    }
    if (typeof options.rpcCommand === 'string') {
      createOptions.rpcCommand = options.rpcCommand;
    }
    if (options.permissionModeOverride) {
      createOptions.permissionModeOverride = options.permissionModeOverride;
    }
    this.host = createAgentHost(createOptions);
  }

  getMode(): HostMode {
    return this.host.mode;
  }

  async dispose(): Promise<void> {
    for (const run of this.activeRuns.cancelAll()) {
      // Mark ownership before publishing shutdown so re-entrant or late SDK
      // events cannot cross the terminal boundary during cleanup.
      this.runEventCorrelator.markRunTerminal(run.sessionId, run.runId);
      this.rememberTerminalRun(run.sessionId, run.runId);
      this.push({
        type: 'event',
        sessionId: run.sessionId,
        event: buildRunTerminalEvent(
          run.sessionId,
          run.runId,
          'cancelled',
          'host-shutdown',
          'host disposed',
        ),
      });
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
    if (this.ptyHost) {
      this.ptyHost.dispose();
      this.ptyHost = null;
    }
    if (this.processRegistry) {
      try {
        await this.processRegistry.dispose();
      } catch {
        // best-effort shutdown
      }
      this.processRegistry = null;
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
    await this.host.dispose();
    this.ready = false;
  }

  async handleCommand(command: HostCommand): Promise<HostResponse> {
    const requestId = typeof command.id === 'string' ? command.id : undefined;
    try {
      const ctx = await this.buildDomainContext();
      const domain = await dispatchDomainCommands(command, requestId, ctx);
      if (domain) {
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

        case 'notes/list': {
          const { store } = await this.getNotesServices();
          const filter: { collection?: string; tags?: string[] } = {};
          if (command.collection) filter.collection = command.collection;
          if (command.tags && command.tags.length > 0) filter.tags = command.tags;
          const records = await store.list(filter);
          return ok(requestId, 'notes/list', { records });
        }
        case 'notes/read': {
          const { store } = await this.getNotesServices();
          const record = await store.read(command.noteId);
          return ok(requestId, 'notes/read', { record });
        }
        case 'notes/search': {
          const services = await this.getNotesServices();
          const { searchNotes } = await import('@piwin/notes');
          const hits = await searchNotes(services.index, command.query, services.searchOptions);
          return ok(requestId, 'notes/search', { hits });
        }
        case 'notes/write': {
          const { store } = await this.getNotesServices();
          const record = await store.write(command.input);
          return ok(requestId, 'notes/write', { record });
        }
        case 'notes/update': {
          const { store } = await this.getNotesServices();
          const record = await store.update(command.input);
          return ok(requestId, 'notes/update', { record });
        }
        case 'notes/delete': {
          const { store } = await this.getNotesServices();
          const result = await store.delete(command.noteId);
          return ok(requestId, 'notes/delete', result);
        }
        case 'notes/reindex': {
          const { index } = await this.getNotesServices();
          await index.rebuild();
          return ok(requestId, 'notes/reindex', { rebuilt: true });
        }
        case 'notes/eval-run': {
          const services = await this.getNotesServices();
          const { loadGoldenSet, runRecallEval, searchNotes } = await import('@piwin/notes');
          const { cases, warnings } = await loadGoldenSet(services.store.getNotesRoot());
          if (cases.length === 0) {
            return fail(
              requestId,
              'notes/eval-run',
              'Golden set empty. Pin cases first (piwin notes pin / search result pin).',
            );
          }
          const k = command.k && command.k > 0 ? Math.floor(command.k) : 5;
          const modes: Array<'fts' | 'vector' | 'hybrid'> = services.searchOptions.embeddingProvider
            ? ['fts', 'vector', 'hybrid']
            : ['fts'];
          const reports = [];
          for (const mode of modes) {
            // Detect embedding-provider degradation so the report never
            // silently labels FTS numbers as vector/hybrid results.
            let degraded = false;
            const report = await runRecallEval({
              cases,
              mode,
              k,
              search: async (query, limit, searchMode) =>
                searchNotes(
                  services.index,
                  { query, limit, mode: searchMode },
                  { ...services.searchOptions, onWarning: () => (degraded = true) },
                ),
              wasDegraded: () => degraded,
            });
            services.index.saveEvalRun(report);
            reports.push(report);
          }
          return ok(requestId, 'notes/eval-run', { reports, warnings });
        }
        case 'notes/eval-history': {
          const { index } = await this.getNotesServices();
          const runs = index.listEvalRuns();
          return ok(requestId, 'notes/eval-history', { runs });
        }

        case 'flashcards/create': {
          const store = await this.getCardStore();
          const card = await store.create(command.input);
          return ok(requestId, 'flashcards/create', { card });
        }
        case 'flashcards/list': {
          const store = await this.getCardStore();
          const filter: { deck?: string; sourceNoteId?: string; sourceFolder?: string } = {};
          if (command.deck) filter.deck = command.deck;
          if (command.sourceNoteId) filter.sourceNoteId = command.sourceNoteId;
          if (command.sourceFolder) filter.sourceFolder = command.sourceFolder;
          const cards = await store.list(filter);
          return ok(requestId, 'flashcards/list', { cards });
        }
        case 'flashcards/batch-create': {
          const store = await this.getCardStore();
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const config = await loadPiwinConfig(rootDir);
          const maxBatchSize = config.flashcards?.maxBatchSize ?? 40;
          const result = await store.batchCreate(command.input, maxBatchSize);
          const { buildFlashcardBatchArtifactHtml } = await import('@piwin/flashcards');
          const artifactHtml = buildFlashcardBatchArtifactHtml(result.created);
          return ok(requestId, 'flashcards/batch-create', { ...result, artifactHtml });
        }
        case 'flashcards/delete': {
          const store = await this.getCardStore();
          const result = await store.delete(command.cardId);
          return ok(requestId, 'flashcards/delete', result);
        }
        case 'flashcards/decks': {
          const store = await this.getCardStore();
          const decks = await store.listDecks();
          return ok(requestId, 'flashcards/decks', { decks });
        }
        case 'flashcards/queue': {
          const store = await this.getCardStore();
          const rootDir = getPiwinRoot(this.options.piwinRoot);
          const config = await loadPiwinConfig(rootDir);
          const { buildReviewQueue } = await import('@piwin/flashcards');
          const cards = await store.list();
          const states = await store.loadReviewStates();
          const queue = buildReviewQueue({
            cards,
            states,
            ...(command.deck ? { deck: command.deck } : {}),
            ...(typeof config.flashcards?.newPerDay === 'number'
              ? { newPerDay: config.flashcards.newPerDay }
              : {}),
            ...(typeof config.flashcards?.maxReviewsPerDay === 'number'
              ? { maxReviewsPerDay: config.flashcards.maxReviewsPerDay }
              : {}),
          });
          return ok(requestId, 'flashcards/queue', { queue });
        }
        case 'flashcards/rate': {
          // Direct user intent from UI (review panel / artifact rate button);
          // no permission gate — equivalent to clicking in the product shell.
          const store = await this.getCardStore();
          const state = await store.rate(command.cardId, command.rating);
          return ok(requestId, 'flashcards/rate', { state });
        }
        case 'flashcards/export': {
          const store = await this.getCardStore();
          const { exportCardsToTsv } = await import('@piwin/flashcards');
          const cards = await store.list(command.deck ? { deck: command.deck } : undefined);
          return ok(requestId, 'flashcards/export', {
            tsv: exportCardsToTsv(cards),
            count: cards.length,
          });
        }
        case 'doccards/scan-folder': {
          const rag = await this.getFolderRag();
          const result = await rag.scanFolder(command.folderPath);
          return ok(requestId, 'doccards/scan-folder', result);
        }
        case 'doccards/index-folder': {
          const rag = await this.getFolderRag();
          const result = await rag.indexFolder(
            command.folderPath,
            command.includeFiles ? { includeFiles: command.includeFiles } : undefined,
          );
          return ok(requestId, 'doccards/index-folder', result);
        }
        case 'doccards/retrieve': {
          const rag = await this.getFolderRag();
          const { canonicalizeFolderPath } = await import('@piwin/doc-rag');
          const canonical = await canonicalizeFolderPath(command.folderPath);
          const chunks = await rag.retrieve(command.folderPath, command.query, {
            ...(command.limit !== undefined ? { limit: command.limit } : {}),
            ...(command.fileAllowlist ? { fileAllowlist: command.fileAllowlist } : {}),
            ...(command.maxTotalChars !== undefined
              ? { maxTotalChars: command.maxTotalChars }
              : {}),
          });
          return ok(requestId, 'doccards/retrieve', {
            chunks,
            canonicalPath: canonical ?? command.folderPath,
            degraded: !rag.hasEmbeddingProvider,
          });
        }
        case 'doccards/list-by-folder': {
          const store = await this.getCardStore();
          const { canonicalizeFolderPath } = await import('@piwin/doc-rag');
          const canonical = await canonicalizeFolderPath(command.folderPath);
          const records = await store.list(
            canonical ? { sourceFolder: canonical } : { sourceFolder: command.folderPath },
          );
          return ok(requestId, 'doccards/list-by-folder', {
            records,
            folderExists: canonical !== null,
            canonicalPath: canonical ?? command.folderPath,
          });
        }
        case 'doccards/rebind-folder': {
          const store = await this.getCardStore();
          const { canonicalizeFolderPath } = await import('@piwin/doc-rag');
          const oldCanonical = await canonicalizeFolderPath(command.oldPath);
          const newCanonical = await canonicalizeFolderPath(command.newPath);
          const result = await store.rebindSourceFolder(
            oldCanonical ?? command.oldPath,
            newCanonical ?? command.newPath,
          );
          return ok(requestId, 'doccards/rebind-folder', result);
        }
        case 'doccards/forget-folder': {
          const store = await this.getCardStore();
          const { canonicalizeFolderPath } = await import('@piwin/doc-rag');
          const canonical = await canonicalizeFolderPath(command.folderPath);
          const result = await store.deleteBySourceFolder(canonical ?? command.folderPath);
          return ok(requestId, 'doccards/forget-folder', result);
        }
        case 'doccards/open-source': {
          const store = await this.getCardStore();
          const card = await store.read(command.cardId);
          if (!card.sourceFolder || !card.sourceFile) {
            throw new Error('Card has no folder source attribution');
          }
          const { canonicalizeFolderPath, isPathConfined } = await import('@piwin/doc-rag');
          const canonical = await canonicalizeFolderPath(card.sourceFolder);
          if (!canonical) {
            throw new Error(`Source folder no longer exists: ${card.sourceFolder}`);
          }
          if (!(await isPathConfined(canonical, card.sourceFile))) {
            throw new Error('Source file path is not confined to the folder');
          }
          const { join } = await import('node:path');
          const absPath = join(canonical, card.sourceFile);
          // Open via OS default; Tauri shell or $EDITOR in real desktop.
          // For host-runtime, return the resolved path so the caller can open it.
          return ok(requestId, 'doccards/open-source', { opened: true, path: absPath });
        }
        default:
          return fail(requestId, 'unknown', 'Unhandled command');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
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
   * Used by gated tools (web_search / web_fetch) during live sessions.
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
      const activeRun = this.activeRuns.get(input.sessionId);
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
    input: import('./extension-ui-bridge.js').ExtensionUiRequest & { sessionId: string },
  ): Promise<import('./extension-ui-bridge.js').ExtensionUiResponse> {
    return new Promise((resolve) => {
      this.pendingExtensionUi.set(input.requestId, {
        resolve,
        kind: input.kind,
      });
      const pushMessage: {
        type: 'extension/ui_request';
        sessionId: string;
        requestId: string;
        kind: import('./extension-ui-bridge.js').ExtensionUiKind;
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
      // Detail format from gated-bash-tool is `<reason>: <command>`. The command
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
   * Attachments are accepted only from piwin's media root. The UI supplies a
   * structured reference; this boundary creates the text-model path metadata.
   */
  private buildModelPromptInput(input: PromptInput): PromptInput {
    if (!input.attachments || input.attachments.length === 0) {
      return input;
    }

    const mediaRoot = getPiwinMediaDir(getPiwinRoot(this.options.piwinRoot));
    const safeAttachments = input.attachments.map((attachment) =>
      validateMediaAttachment(mediaRoot, attachment),
    );
    const imageInjections = safeAttachments.map((attachment) =>
      formatTextModelImageInjection({
        absolutePath: attachment.path,
        mimeType: attachment.mimeType,
        byteSize: attachment.byteSize,
        ...(attachment.width !== undefined ? { width: attachment.width } : {}),
        ...(attachment.height !== undefined ? { height: attachment.height } : {}),
      }),
    );

    return {
      ...input,
      text: [input.text, ...imageInjections].filter(Boolean).join('\n\n'),
      attachments: safeAttachments,
    };
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

  private getPtyHost(): PtyHost {
    if (!this.ptyHost) {
      this.ptyHost = new PtyHost({
        isProjectTrusted: async (projectPath) => {
          try {
            const rootDir = getPiwinRoot(this.options.piwinRoot);
            const project = await openOrCreateProject(getPiwinProjectsPath(rootDir), projectPath);
            return project.trust === 'trusted';
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            this.push({
              type: 'host/log',
              level: 'warn',
              message: `pty trust check failed for ${projectPath}: ${detail}`,
            });
            return false;
          }
        },
        onOutput: (ptyId, data) => {
          this.push({
            type: 'pty/output',
            ptyId,
            data,
            at: new Date().toISOString(),
          });
        },
        onExit: (ptyId, exitCode) => {
          const payload: { type: 'pty/exit'; ptyId: string; exitCode?: number | null } = {
            type: 'pty/exit',
            ptyId,
          };
          if (exitCode !== undefined) {
            payload.exitCode = exitCode;
          }
          this.push(payload);
        },
      });
    }
    return this.ptyHost;
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
          executionMode: 'agent',
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
      const message = error instanceof Error ? error.message : String(error);
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

  private getProcessRegistry(): ProcessRegistry {
    if (!this.processRegistry) {
      throw new Error('Process registry is not available');
    }
    return this.processRegistry;
  }

  private async stopProcessesForSession(sessionId: string): Promise<void> {
    const processRegistry = this.processRegistry;
    if (!processRegistry) {
      return;
    }
    try {
      const stopped = await processRegistry.stopForSession(sessionId);
      if (stopped.length > 0) {
        this.push({
          type: 'host/log',
          level: 'info',
          message: `stopped ${stopped.length} session-bound process(es) for ${sessionId}`,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.push({
        type: 'host/log',
        level: 'warn',
        message: `session-bound process cleanup failed: ${message}`,
      });
    }
  }

  private emitProcessEvent(event: {
    type: string;
    process?: unknown;
    processId?: string;
    exitCode?: number | null;
    chunk?: unknown;
  }): void {
    const processRecord = event.process as { sessionId?: string } | undefined;
    const sessionId =
      (processRecord && typeof processRecord.sessionId === 'string'
        ? processRecord.sessionId
        : undefined) ??
      (typeof event.processId === 'string'
        ? this.processRegistry?.get(event.processId)?.sessionId
        : undefined) ??
      '';

    if (!sessionId) {
      return;
    }

    if (event.type === 'process/started' && event.process) {
      this.push({
        type: 'event',
        sessionId,
        event: {
          type: 'process/started',
          process: event.process as never,
        },
      });
      return;
    }
    if (event.type === 'process/updated' && event.process) {
      this.push({
        type: 'event',
        sessionId,
        event: {
          type: 'process/updated',
          process: event.process as never,
        },
      });
      return;
    }
    if (event.type === 'process/exited') {
      this.push({
        type: 'event',
        sessionId,
        event: {
          type: 'process/exited',
          processId: String(event.processId ?? ''),
          ...(event.exitCode !== undefined ? { exitCode: event.exitCode } : {}),
          ...(event.process ? { process: event.process as never } : {}),
        },
      });
      return;
    }
    if (event.type === 'process/log' && event.chunk) {
      this.push({
        type: 'event',
        sessionId,
        event: {
          type: 'process/log',
          chunk: event.chunk as never,
        },
      });
    }
  }

  private getMcpManager(): McpLifecycleManager {
    if (!this.mcpManager) {
      // dispose() nulls the manager; recreate only if commands arrive after partial teardown.
      this.mcpManager = createMcpLifecycleManager(getPiwinRoot(this.options.piwinRoot));
    }
    return this.mcpManager;
  }

  private isRpcSdkFallback(): boolean {
    if (this.options.mock === true || process.env.PIWIN_MOCK === '1') {
      return false;
    }
    if (this.host.mode !== 'rpc') {
      return false;
    }
    const maybe = this.host as { usesSdkFallback?: () => boolean };
    if (typeof maybe.usesSdkFallback === 'function') {
      return maybe.usesSdkFallback();
    }
    // Default product path for rpc after D-EXT-07.
    return process.env.PIWIN_RPC_STOCK !== '1';
  }

  private buildSessionLiveContext(): SessionLiveContext {
    return {
      ...(this.options.piwinRoot !== undefined ? { piwinRoot: this.options.piwinRoot } : {}),
      host: this.host,
      createSession: (input) => this.createSession(input),
      sessions: this.sessions,
      sessionExecutionModes: this.sessionExecutionModes,
      sessionFilesTouched: this.sessionFilesTouched,
      sessionLastPromptText: this.sessionLastPromptText,
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
      stopProcessesForSession: (sessionId) => this.stopProcessesForSession(sessionId),
      recordUserPrompt: (sessionId, input) => this.recordUserPrompt(sessionId, input),
      touchSession: (sessionId, previewText) => this.touchSession(sessionId, previewText),
      needsProductHistoryInjection: (sessionId) =>
        this.sessions.get(sessionId)?.needsProductHistoryInjection?.() === true,
      ensureLiveSession: (sessionId) => this.ensureLiveSession(sessionId),
      resolveAutoCompaction: (sessionId) => this.resolveAutoCompaction(sessionId),
      handleMergeSubagent: (requestId, childSessionId, force) =>
        this.handleMergeSubagent(requestId, childSessionId, force),
      buildModelPromptInput: (input) => this.buildModelPromptInput(input),
      runWithContext: (runId, operation) => {
        void this.runExecutionContext.run(runId, operation);
      },
      getActiveRun: (sessionId) => this.activeRuns.get(sessionId),
      // RunEventCorrelator observes active-run changes on each provider event.
      // The registry rejects overlapping registration, so there is no separate
      // host-side replacement transition to mark here.
      registerActiveRun: (sessionId) => this.activeRuns.register(sessionId),
      requestCancelActiveRun: (sessionId, runId) => this.activeRuns.requestCancel(sessionId, runId),
      markActiveRunTerminal: (sessionId, runId) => this.activeRuns.markTerminal(sessionId, runId),
      clearActiveRun: (sessionId, runId) => this.activeRuns.clear(sessionId, runId),
      emitRunPhase: (sessionId, runId, phase, detail) => {
        this.push({
          type: 'event',
          sessionId,
          event:
            detail === undefined
              ? buildRunPhaseEvent(sessionId, runId, phase)
              : buildRunPhaseEvent(sessionId, runId, phase, detail),
        });
      },
      emitRunTerminal: (sessionId, runId, outcome, code, message) => {
        if (!this.activeRuns.markTerminal(sessionId, runId)) {
          return false;
        }
        // The terminal event is emitted directly by the host, so explicitly
        // close correlator ownership before the active run is cleared.
        this.runEventCorrelator.markRunTerminal(sessionId, runId);
        this.rememberTerminalRun(sessionId, runId);
        this.push({
          type: 'event',
          sessionId,
          event: buildRunTerminalEvent(sessionId, runId, outcome, code, message),
        });
        this.activeRuns.clear(sessionId, runId);
        // CE-NAME: auto-name after first completed exchange (fire-and-forget).
        if (outcome === 'completed') {
          void this.maybeTriggerAutoName(sessionId).catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
            this.push({ type: 'host/log', level: 'warn', message: `auto-name failed: ${detail}` });
          });
        }
        const recorder = this.transcriptRecorders.get(sessionId);
        if (recorder) {
          void recorder.flush().catch((error: unknown) => {
            const detail = error instanceof Error ? error.message : String(error);
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
    };
  }

  private ensurePetStateStore(): Promise<PetStateStore> {
    if (this.petStateStoreInit) return this.petStateStoreInit;
    this.petStateStoreInit = (async () => {
      const root = this.options.piwinRoot;
      let base: PetRuntimeSnapshot;
      if (root) {
        try {
          base = await getActivePet(root, 'idle');
        } catch {
          base = fallbackPetSnapshot();
        }
      } else {
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

  private async buildDomainContext(): Promise<import('./commands/domain-command-dispatch.js').DomainDispatchContext> {
    const hostContext: HostCommandContext = {
      ...(this.options.piwinRoot !== undefined ? { piwinRoot: this.options.piwinRoot } : {}),
      push: (message) => this.push(message),
      requireSession: (sessionId) => this.requireSession(sessionId),
      getMcpManager: () => this.getMcpManager(),
      getProcessRegistry: () => this.getProcessRegistry(),
      getPtyHost: () => this.getPtyHost(),
      todoStore: this.todoStore,
      petStateStore: await this.ensurePetStateStore(),
      runCronJob: (job) => this.runCronJob(job),
      pendingPermissions: this.pendingPermissions,
      pendingExtensionUi: this.pendingExtensionUi,
      rememberProjectPermission: (sessionId, action, detail, scope, projectPath) =>
        this.rememberProjectPermission(sessionId, action, detail, scope, projectPath),
    };
    return {
      ...hostContext,
      sessionProduct: {
        ...(this.options.piwinRoot !== undefined ? { piwinRoot: this.options.piwinRoot } : {}),
        host: this.host,
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
        // RPC product path uses SDK session backend (D-EXT-07) so tools work.
        customTools: this.host.mode === 'sdk' || this.isRpcSdkFallback(),
        mcpLifecycle: true,
        productTranscript: true,
        // Compaction requires a live handle with compact(); SDK/mock support it.
        compaction:
          this.host.mode === 'sdk' || this.options.mock === true || this.isRpcSdkFallback(),
        extensions:
          this.host.mode === 'sdk' || this.isRpcSdkFallback() || this.options.mock === true,
        prompts: this.host.mode === 'sdk' || this.isRpcSdkFallback() || this.options.mock === true,
        ...(this.host.mode === 'rpc' && this.isRpcSdkFallback() ? { rpcSdkFallback: true } : {}),
        extensionUiBridge: true,
        sessionSearch: true,
        sessionPin: true,
        sessionLifecycle: true,
        usage: true,
        process: true,
        sessionExport: true,
        // ADR 0013: real Tauri PTY not shipped — do not claim interactive PTY.
        pty: false,
        shellPreview: true,
        subagentWorktree: true,
        marketplaceHub: true,
        automation: true,
      },
    };
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
            name: sessionName ?? `session-${session.id.slice(0, 8)}`,
          };
          if (!projectPath) {
            recordInput.scope = { kind: 'general' };
            // workingDirectory filled by adapter persist or on next resolve
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
        const detail = error instanceof Error ? error.message : String(error);
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `session index write failed: ${detail}`,
        });
      }
    }

    this.ensureTranscriptRecorder(
      session.id,
      projectPath ?? this.sessionProjects.get(session.id) ?? 'unknown',
    );

    const unsubscribe = session.subscribe((event: AgentEvent) => {
      const activeRun = this.activeRuns.get(session.id);
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
      if (
        correlatedRunId !== undefined &&
        (this.isTerminalRun(session.id, correlatedRunId) ||
          (activeRunId !== undefined && correlatedRunId !== activeRunId))
      ) {
        // Context-owned events can have no explicit runId. The correlator
        // annotates them, and this second check prevents old async callbacks
        // from reaching push, hooks, usage, or transcript recording.
        return;
      }
      this.push({ type: 'event', sessionId: session.id, event: correlatedEvent });
      void this.ensurePetStateStore().then((store) => store.reduce(correlatedEvent));
      const nextPhase = this.activeRuns.noteAgentEvent(session.id, correlatedEvent);
      if (nextPhase !== null) {
        const active = this.activeRuns.get(session.id);
        if (active) {
          this.push({
            type: 'event',
            sessionId: session.id,
            event: buildRunPhaseEvent(session.id, active.runId, nextPhase),
          });
        }
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
      }
      // CE-OBS: if mock/host did not emit usage, estimate after assistant message ends.
      if (correlatedEvent.type === 'message/end') {
        void this.maybeEmitUsageOnMessageEnd(session.id, correlatedEvent.messageId);
      }
      // CE-HOOK: arm matching hooks on normalized AgentEvent (best-effort, never fails turn).
      void this.dispatchHooksForAgentEvent(session.id, correlatedEvent).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.push({
          type: 'host/log',
          level: 'warn',
          message: `hook dispatch failed: ${message}`,
        });
      });
      const recorder = this.transcriptRecorders.get(session.id);
      if (recorder) {
        void recorder.recordEvent(correlatedEvent).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
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
      const message = error instanceof Error ? error.message : String(error);
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

  private async handleMergeSubagent(
    requestId: string | undefined,
    childSessionId: string,
    force: boolean,
  ): Promise<HostResponse> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const child = await getSessionRecord(indexPath, childSessionId);
    if (!child) {
      return fail(requestId, 'session/merge-subagent', `Unknown session: ${childSessionId}`);
    }
    if (child.kind !== 'subagent' || !child.parentSessionId) {
      return fail(requestId, 'session/merge-subagent', 'session is not a sub-agent with parent');
    }
    const parentSessionId = child.parentSessionId;
    const parent = await getSessionRecord(indexPath, parentSessionId);
    if (!parent) {
      return fail(
        requestId,
        'session/merge-subagent',
        `Unknown parent session: ${parentSessionId}`,
      );
    }

    const prior = this.mergeLocks.get(parentSessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.mergeLocks.set(
      parentSessionId,
      prior.then(() => gate),
    );
    await prior;

    try {
      // Re-read after lock for idempotency.
      const latestChild = await getSessionRecord(indexPath, childSessionId);
      if (!latestChild) {
        return fail(requestId, 'session/merge-subagent', `Unknown session: ${childSessionId}`);
      }
      if (latestChild.mergedAt && latestChild.mergeMessageId && !force) {
        return ok(requestId, 'session/merge-subagent', {
          childSessionId,
          parentSessionId,
          messageId: latestChild.mergeMessageId,
          alreadyMerged: true,
        });
      }

      const childMessages = await listTranscriptMessages(
        getPiwinSessionTranscriptPath(rootDir, childSessionId),
      );
      const summaryInput: Parameters<typeof buildSubagentMergeSummary>[0] = {
        status: latestChild.subagentStatus ?? 'done',
        messages: childMessages,
      };
      if (latestChild.task) summaryInput.task = latestChild.task;
      if (latestChild.name) summaryInput.name = latestChild.name;
      const summary = buildSubagentMergeSummary(summaryInput);
      const messageId = randomUUID();
      const cardText = formatSubagentMergeCard({
        summaryText: summary.summaryText,
        childSessionId,
      });
      const now = new Date().toISOString();
      const activity = buildSubagentActivityView({
        childSessionId,
        status: latestChild.subagentStatus ?? 'done',
        merged: true,
        updatedAt: now,
        ...(latestChild.name ? { displayName: latestChild.name } : {}),
        ...(latestChild.task ? { task: latestChild.task } : {}),
        ...(latestChild.worktreePath ? { worktreePath: latestChild.worktreePath } : {}),
      });
      const mergeMessage = {
        id: messageId,
        role: 'system' as const,
        text: cardText,
        createdAt: now,
        status: 'done' as const,
        subagentActivity: activity,
      };
      await appendTranscriptMessage(
        getPiwinSessionTranscriptPath(rootDir, parentSessionId),
        parentSessionId,
        parent.projectPath,
        mergeMessage,
      );
      this.push({
        type: 'transcript/append',
        sessionId: parentSessionId,
        message: mergeMessage,
      });

      latestChild.mergedAt = now;
      latestChild.mergeMessageId = messageId;
      latestChild.summaryPreview = summary.preview;
      latestChild.updatedAt = now;
      if (!latestChild.subagentStatus || latestChild.subagentStatus === 'running') {
        latestChild.subagentStatus = 'done';
      }
      await upsertSessionRecord(indexPath, latestChild);

      this.push({
        type: 'subagent/merged',
        parentSessionId,
        childSessionId,
        messageId,
      });
      this.push({
        type: 'subagent/updated',
        parentSessionId,
        child: indexRecordToSummary(latestChild),
      });
      this.push({
        type: 'host/log',
        level: 'info',
        message: `merged subagent ${childSessionId} into parent ${parentSessionId} (${summary.preview.length} preview chars)`,
      });

      return ok(requestId, 'session/merge-subagent', {
        childSessionId,
        parentSessionId,
        messageId,
        alreadyMerged: false,
        summaryPreview: summary.preview,
      });
    } finally {
      release();
    }
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
      name: `session-${sessionId.slice(0, 8)}`,
    });
    record.messageCount = 1;
    record.lastPreview = preview.slice(0, 160);
    await upsertSessionRecord(indexPath, record);
  }

  /** CE-NAME: auto-name after first completed exchange (fire-and-forget). */
  private async maybeTriggerAutoName(sessionId: string): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, sessionId);
    if (!record) {
      return;
    }
    // Only auto-name after the first exchange (user + assistant = messageCount >= 2).
    if (record.messageCount < 2) {
      return;
    }
    // Never overwrite a user-set name.
    if (record.nameSource === 'user') {
      return;
    }
    // Only trigger once: if we already have an auto name, do not re-run.
    if (record.nameSource === 'auto' && record.name) {
      return;
    }
    const firstMessage = this.sessionLastPromptText.get(sessionId) ?? '';
    if (!firstMessage) {
      return;
    }
    const config = await loadPiwinConfig(rootDir);
    const modelRef = this.sessionModels.get(sessionId);
    await maybeAutoNameSession({
      piwinRoot: this.options.piwinRoot ?? rootDir,
      sessionId,
      firstMessage,
      ...(modelRef ? { modelRef } : {}),
      providers: config.providers ?? [],
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
    const executionMode = this.sessionExecutionModes.get(sessionId) ?? 'agent';
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
          const createInput = { ...input, executionMode };
          return this.createSession(createInput);
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
    const live = this.sessions.get(sessionId);
    if (!live) {
      return;
    }
    try {
      await live.abort();
    } catch {
      // best-effort
    }
  }

  private async disposeLiveSession(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    const activeRun = this.activeRuns.get(sessionId);
    if (activeRun) {
      // Abort can synchronously produce provider events; close ownership
      // before invoking it so explicit old-run events are rejected.
      this.runEventCorrelator.markRunTerminal(sessionId, activeRun.runId);
      this.rememberTerminalRun(sessionId, activeRun.runId);
    }
    if (live) {
      try {
        await live.abort();
      } catch {
        // best-effort
      }
      this.sessions.delete(sessionId);
    }
    const unsub = this.unsubscribers.get(sessionId);
    if (unsub) {
      unsub();
      this.unsubscribers.delete(sessionId);
    }
    this.sessionProjects.delete(sessionId);
    this.sessionExecutionModes.delete(sessionId);
    this.sessionModels.delete(sessionId);
    const recorder = this.transcriptRecorders.get(sessionId);
    if (recorder) {
      try {
        await recorder.flush();
      } catch {
        // best-effort
      }
      this.transcriptRecorders.delete(sessionId);
    }
  }

  private requireSession(sessionId: string): SessionHandle {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  private async createSession(input: CreateSessionInput): Promise<SessionHandle> {
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
      case undefined:
        return this.host.createSession(input);
      default:
        throw new Error(`Unsupported host test fixture: ${this.options.testFixture}`);
    }
  }

  private push(message: HostPush): void {
    if (message.type === 'event') {
      const generator =
        this.eventEnvelopeGenerators.get(message.sessionId) ?? createEventEnvelopeGenerator();
      this.eventEnvelopeGenerators.set(message.sessionId, generator);
      const envelope: AgentEventEnvelope = generator.next(readEventRunId(message.event));
      this.options.onPush?.({ ...message, envelope });
      return;
    }
    if (this.options.onPush) {
      this.options.onPush(message);
    }
  }

  private rememberTerminalRun(sessionId: string, runId: string): void {
    let terminalRunIds = this.terminalRunIdsBySession.get(sessionId);
    if (!terminalRunIds) {
      terminalRunIds = new Set<string>();
      this.terminalRunIdsBySession.set(sessionId, terminalRunIds);
    }
    terminalRunIds.add(runId);
  }

  private isTerminalRun(sessionId: string, runId: string): boolean {
    return this.terminalRunIdsBySession.get(sessionId)?.has(runId) === true;
  }
}

/**
 * Extract the bash command from a gated-bash permission detail.
 *
 * The gated bash tool formats detail as `<reason>: <command>` (see
 * `gated-bash-tool.ts`). The command is the remainder after the first
 * `": "` separator, so a reason containing `: ` cannot steal command text.
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

function validateMediaAttachment(
  mediaRoot: string,
  attachment: MediaAttachmentRef,
): MediaAttachmentRef {
  const path = assertInsideMediaRoot(mediaRoot, attachment.path);
  const safeAttachment: MediaAttachmentRef = {
    id: attachment.id,
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
}

function createCancelledExtensionUiResponse(
  kind: import('./extension-ui-bridge.js').ExtensionUiKind,
): import('./extension-ui-bridge.js').ExtensionUiResponse {
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
