import type {
  AgentHost,
  AgentHostFactoryOptions,
  CreateSessionInput,
  PermissionDecision,
  PermissionMode,
  PermissionRuleSet,
  SessionHandle,
  SessionScope,
  SessionSummary,
} from '@piwin/contracts';
import {
  createSessionRecord,
  getSessionRecord,
  listSessionsForProject,
  listTranscriptMessages,
  upsertSessionRecord,
} from '@piwin/session';
import { createMcpLifecycleManager, type McpLifecycleManager } from '@piwin/mcp';
import { createProcessRegistry, type ProcessRegistry } from '@piwin/process';
import { createMockSessionHandle } from './mock-session.js';
import { createProductShellSession } from './product-shell-session.js';
import { createPiSessionEventMapper } from './event-map.js';
import { loadPiwinConfig } from './config-store.js';
import { mapThinkingLevelToApi } from './map-thinking-level.js';
import {
  getPiwinRoot,
  getPiwinProjectsPath,
  getPiwinSessionIndexPath,
  getPiwinSessionPlanPath,
  getPiwinSessionTranscriptPath,
  getPiwinMediaDir,
} from './paths.js';
import { createPlanStepTool } from './plan-step-tool.js';
import { createPlanCreateTool } from './plan-create-tool.js';
import { buildImageGenTool } from './image-gen-tool.js';
import { createSubagentRunTool } from './subagent-run-tool.js';
import { buildSessionTools } from './session-tools.js';
import { toPiCustomTools } from './pi-tool-adapter.js';
import { createPiResourceLoader } from './pi-resource-loader.js';
import { bindExtensionUiToPiSession, createExtensionUiContext } from './extension-ui-bridge.js';
import { createMcpSessionBridge } from './mcp-session-bridge.js';
import { buildGatedBashToolDefinition } from './gated-bash-tool.js';
import { buildGatedFileToolsDefinition } from './gated-file-tools.js';
import { buildProcessTools } from './process-tools.js';
import { createNoteStore, openNoteIndex, createEmbeddingProvider } from '@piwin/notes';
import { buildNotesTools } from './notes-tools.js';
import { resolveNotesEmbeddingApiKey } from './notes-embedding-secret.js';
import { createCardStore } from '@piwin/flashcards';
import { buildFlashcardTools } from './flashcard-tools.js';
import { createBrowserToolDefinitions } from './browser-tools.js';
import { createSecretResolver } from './secret-resolver.js';
import {
  buildPiProviderRegistration,
  type PiModelRuntime,
  type PiModelRegistration,
} from './pi-model-runtime.js';
import { listProjects } from '@piwin/project';
import { loadMergedPermissionRules } from './permission-rule-loader.js';
import { createBundledRuleSet } from './permission-defaults.js';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { extractFileOpsFromUnknown } from './compaction-file-ops.js';
import { indexRecordToSummary } from './session-summary-map.js';
import {
  indexProjectPathForScope,
  resolveAgentCwd,
  resolveSessionLocation,
  scopeFromIndexRecord,
} from './session-scope.js';

export type PiSdkPermissionRequest = {
  sessionId: string;
  projectPath: string;
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
  signal?: AbortSignal;
};

/**
 * Adapt the host permission handler into the gate-input shape used by the
 * gated bash / file tools. Both gates accept the same `{action, detail,
 * defaultDecision, signal}` input; this wrapper reuses one closure for both.
 */
function wrapPermissionHandler(
  permissionHandler: (request: PiSdkPermissionRequest) => Promise<PermissionDecision>,
  sessionId: string,
  permissionProjectPath: string,
): (request: {
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
  signal?: AbortSignal;
}) => Promise<PermissionDecision> {
  return async (gateInput) =>
    permissionHandler({
      sessionId,
      projectPath: permissionProjectPath,
      action: gateInput.action,
      detail: gateInput.detail,
      defaultDecision: gateInput.defaultDecision,
      ...(gateInput.signal ? { signal: gateInput.signal } : {}),
    });
}

export type PiSdkAdapterOptions = {
  piwinRoot?: string;
  /** Force mock sessions (no Pi dependency). */
  mock?: boolean;
  onPermissionRequest?: (request: PiSdkPermissionRequest) => Promise<PermissionDecision>;
  /**
   * Shared MCP process owner. When omitted, adapter creates one for this host.
   */
  lifecycleManager?: McpLifecycleManager;
  /**
   * Bridge Pi ExtensionUIContext dialogs to Desktop (D-EXT-04).
   */
  onExtensionUiRequest?: (
    request: import('./extension-ui-bridge.js').ExtensionUiRequest & { sessionId: string },
  ) => Promise<import('./extension-ui-bridge.js').ExtensionUiResponse>;
  onExtensionNotify?: (message: string, level: 'info' | 'warning' | 'error') => void;
  /** Shared CE-PROC registry from HostRuntime; adapter owns one if omitted. */
  processRegistry?: ProcessRegistry;
  /**
   * Host-level log sink (ADR 0019 §3). Used to surface permission policy
   * downgrades (e.g. `bypass` refused for an untrusted project) as `host/log`
   * warnings so the user is informed that the effective mode changed.
   */
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void;
  /**
   * Session-level permission mode override (ADR 0019 §3). Takes precedence
   * over `config.permissions.mode` without persisting to disk. The bypass
   * guard still narrows `bypass` to `auto` for untrusted projects.
   */
  permissionModeOverride?: PermissionMode;
  /**
   * Subagent delegation seam for the model-facing piwin_subagent_run tool.
   * HostRuntime injects these to route spawn/merge through session/* commands
   * without giving the adapter a back-reference to HostRuntime (no circular dep).
   * Only used in SDK mode (ADR 0008: RPC cannot register custom tools).
   */
  onSpawnSubagent?: (input: {
    parentSessionId: string;
    task: string;
    mode?: import('@piwin/contracts').SubagentIsolationMode;
    applyPolicy?: import('@piwin/contracts').SubagentApplyPolicy;
    sessionName?: string;
  }) => Promise<{ childSessionId: string }>;
  onMergeSubagent?: (
    childSessionId: string,
  ) => Promise<{ summaryPreview?: string; alreadyMerged?: boolean }>;
  /**
   * Host-owned browser session (ADR 0020). When present, `browser_*` tools are
   * appended to the coding/agent tool set. Lazily provided so HostRuntime can
   * create the session before the first Pi session without a static import.
   */
  getBrowserSession?: () => import('@piwin/browser').BrowserSession | undefined;
};

/**
 * In-process Pi SDK adapter.
 * Real path: @earendil-works/pi-coding-agent createAgentSession.
 * Providers come from ~/.piwin/config.json + env API keys.
 */
export class PiSdkAdapter implements AgentHost {
  readonly mode = 'sdk' as const;
  private readonly sessions = new Map<string, SessionHandle>();
  private readonly sessionCleanups = new Map<string, () => Promise<void>>();
  private readonly options: PiSdkAdapterOptions;
  /** Only set when this adapter owns the manager (not injected by HostRuntime). */
  private ownedProcessRegistry: ProcessRegistry | null = null;
  private ownedLifecycleManager: McpLifecycleManager | null = null;

  constructor(options: PiSdkAdapterOptions = {}) {
    this.options = options;
  }

  async createSession(input: CreateSessionInput): Promise<SessionHandle> {
    const useMock = await this.shouldUseMock();
    const location = await resolveSessionLocation(input, this.options.piwinRoot);
    const resolvedInput: CreateSessionInput = {
      ...input,
      scope: location.scope,
      // Keep index projectPath empty for general; cwd resolved inside createPiSdkSession.
      projectPath: indexProjectPathForScope(location.scope),
    };
    if (useMock) {
      const session = createMockSessionHandle(resolvedInput);
      this.sessions.set(session.id, session);
      await this.persistSessionMeta(
        session.id,
        location.scope,
        location.workingDirectory,
        input.sessionName,
      );
      return session;
    }

    try {
      const session = await createPiSdkSession(resolvedInput, this.sessionAdapterOptions());
      this.sessions.set(session.id, session);
      const cleanup = (session as SessionHandle & { __piwinCleanup?: () => Promise<void> })
        .__piwinCleanup;
      if (cleanup) {
        this.sessionCleanups.set(session.id, cleanup);
      }
      await this.persistSessionMeta(
        session.id,
        location.scope,
        location.workingDirectory,
        input.sessionName,
      );
      return session;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `PiSdkAdapter failed to create real session (${message}). ` +
          'Configure providers in ~/.piwin/config.json (openai-compatible / anthropic-compatible) ' +
          'and set API key env vars, or use --mock / agentMock:true.',
      );
    }
  }

  async resumeSession(sessionId: string): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = await getSessionRecord(indexPath, sessionId);
    if (!record) {
      throw new Error(`Unknown session id: ${sessionId}`);
    }

    const transcriptPath = getPiwinSessionTranscriptPath(rootDir, sessionId);
    const seedMessages = await listTranscriptMessages(transcriptPath);
    const useMock = await this.shouldUseMock();
    const scope = scopeFromIndexRecord(record);
    const location = await resolveSessionLocation(
      { scope, projectPath: record.projectPath },
      this.options.piwinRoot,
    );

    if (useMock) {
      const mockOptions: Parameters<typeof createMockSessionHandle>[0] = {
        projectPath: indexProjectPathForScope(scope) || location.workingDirectory,
        scope,
        sessionId,
        seedMessages,
      };
      if (record.name) {
        mockOptions.sessionName = record.name;
      }
      const session = createMockSessionHandle(mockOptions);
      this.sessions.set(sessionId, session);
      return session;
    }

    // Live mode: product shell keeps stable id + transcript; Pi handle is created on first prompt.
    const shellOptions: Parameters<typeof createProductShellSession>[0] = {
      sessionId,
      projectPath: indexProjectPathForScope(scope) || location.workingDirectory,
      scope,
      workingDirectory: location.workingDirectory,
      seedMessages,
      createLiveSession: async (input) => {
        const live = await createPiSdkSession(input, this.sessionAdapterOptions());
        const cleanup = (live as SessionHandle & { __piwinCleanup?: () => Promise<void> })
          .__piwinCleanup;
        if (cleanup) {
          this.sessionCleanups.set(sessionId, cleanup);
        }
        return live;
      },
    };
    if (record.name) {
      shellOptions.sessionName = record.name;
    }
    const shell = createProductShellSession(shellOptions);
    this.sessions.set(sessionId, shell);
    return shell;
  }

  async dropSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    if (!session) {
      return;
    }
    try {
      await session.abort();
    } catch {
      // best-effort: the live Pi handle may already be gone
    }
    const cleanup = this.sessionCleanups.get(sessionId);
    if (cleanup) {
      this.sessionCleanups.delete(sessionId);
      try {
        await cleanup();
      } catch {
        // best-effort
      }
    }
  }

  async listSessions(scopeOrProjectPath: string | SessionScope): Promise<SessionSummary[]> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    try {
      const indexed = await listSessionsForProject(indexPath, scopeOrProjectPath);
      if (indexed.length > 0) {
        return indexed.map((item) => indexRecordToSummary(item));
      }
    } catch {
      // fall through to in-memory
    }
    const now = new Date().toISOString();
    const fallbackScope: SessionScope =
      typeof scopeOrProjectPath === 'string'
        ? { kind: 'project', projectPath: scopeOrProjectPath }
        : scopeOrProjectPath;
    const fallbackProjectPath = fallbackScope.kind === 'project' ? fallbackScope.projectPath : '';
    const fallbackWorkingDirectory =
      fallbackScope.kind === 'project' ? fallbackScope.projectPath : rootDir;
    return [...this.sessions.entries()].map(([id]) => ({
      id,
      scope: fallbackScope,
      workingDirectory: fallbackWorkingDirectory,
      projectPath: fallbackProjectPath,
      updatedAt: now,
      messageCount: 0,
      name: `session-${id.slice(0, 8)}`,
    }));
  }

  async dispose(): Promise<void> {
    for (const cleanup of this.sessionCleanups.values()) {
      try {
        await cleanup();
      } catch {
        // best-effort
      }
    }
    this.sessionCleanups.clear();
    this.sessions.clear();
    if (this.ownedProcessRegistry) {
      try {
        await this.ownedProcessRegistry.dispose();
      } catch {
        // best-effort shutdown
      }
      this.ownedProcessRegistry = null;
    }
    if (this.ownedLifecycleManager) {
      try {
        await this.ownedLifecycleManager.dispose();
      } catch {
        // best-effort shutdown
      }
      this.ownedLifecycleManager = null;
    }
  }

  private async shouldUseMock(): Promise<boolean> {
    if (this.options.mock === true || process.env.PIWIN_MOCK === '1') {
      return true;
    }
    if (this.options.mock === false) {
      return false;
    }
    try {
      const config = await loadPiwinConfig(this.options.piwinRoot);
      return config.agentMock === true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve the process-scoped MCP manager for session bridges.
   * Prefer injected HostRuntime manager; otherwise own one for bare createAgentHost.
   */
  private getLifecycleManager(): McpLifecycleManager {
    if (this.options.lifecycleManager) {
      return this.options.lifecycleManager;
    }
    if (!this.ownedLifecycleManager) {
      this.ownedLifecycleManager = createMcpLifecycleManager(getPiwinRoot(this.options.piwinRoot));
    }
    return this.ownedLifecycleManager;
  }

  private sessionAdapterOptions(): PiSdkAdapterOptions {
    return {
      ...this.options,
      lifecycleManager: this.getLifecycleManager(),
    };
  }

  private async persistSessionMeta(
    sessionId: string,
    scope: SessionScope,
    workingDirectory: string,
    sessionName?: string,
  ): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = createSessionRecord({
      id: sessionId,
      projectPath: indexProjectPathForScope(scope),
      scope,
      workingDirectory,
      name: sessionName ?? `session-${sessionId.slice(0, 8)}`,
    });
    // best-effort index write — surface failure so users see why a
    // session may be missing from the list (corrupt index, permissions).
    try {
      await upsertSessionRecord(indexPath, record);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[piwin] session index write failed: ${detail}`);
    }
  }
}

async function createPiSdkSession(
  input: CreateSessionInput,
  adapterOptions: PiSdkAdapterOptions,
): Promise<SessionHandle> {
  const piwinRoot = adapterOptions.piwinRoot;
  const config = await loadPiwinConfig(piwinRoot);
  applyProviderEnv(config);
  const location = await resolveSessionLocation(input, piwinRoot);
  const agentCwd = resolveAgentCwd(location, input.cwd);
  const permissionProjectPath =
    location.scope.kind === 'project' ? location.scope.projectPath : location.workingDirectory;

  const piModule = await import('@earendil-works/pi-coding-agent');
  const createAgentSession = (piModule as { createAgentSession?: unknown }).createAgentSession;
  if (typeof createAgentSession !== 'function') {
    throw new Error('createAgentSession export missing from @earendil-works/pi-coding-agent');
  }

  // Pre-allocate session id for permission correlation before Pi returns.
  const sessionId = cryptoRandomId();
  const rootDir = getPiwinRoot(piwinRoot);
  const agentDir = join(homedir(), '.pi', 'agent');

  const permissionHandler = adapterOptions.onPermissionRequest;
  const requestPermission = permissionHandler
    ? async (gateInput: {
        action: string;
        detail: string;
        defaultDecision: PermissionDecision;
        signal?: AbortSignal;
      }) =>
        permissionHandler({
          sessionId,
          projectPath: permissionProjectPath,
          action: gateInput.action,
          detail: gateInput.detail,
          defaultDecision: gateInput.defaultDecision,
          ...(gateInput.signal ? { signal: gateInput.signal } : {}),
        })
    : undefined;

  const readonlySubagent = input.subagent?.mode === 'readonly';
  const toolBuildOptions: import('./session-tools.js').BuildSessionToolsOptions = {
    projectPath: agentCwd,
    projectsFilePath: getPiwinProjectsPath(rootDir),
  };
  if (config.web) {
    toolBuildOptions.webConfig = config.web;
  }
  if (requestPermission) {
    toolBuildOptions.requestPermission = requestPermission;
  }
  const { tools: webTools } = buildSessionTools(toolBuildOptions);

  // Load merged permission rules once (shared by MCP bridge + gated file tools).
  // Trust lookup runs here so untrusted repos cannot grant themselves allow rules.
  const projectsFilePath = getPiwinProjectsPath(rootDir);
  let projectTrusted = false;
  if (permissionProjectPath) {
    try {
      const projects = await listProjects(projectsFilePath);
      projectTrusted = projects.find((p) => p.path === permissionProjectPath)?.trust === 'trusted';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[piwin] project trust lookup failed: ${message}`);
      projectTrusted = false;
    }
  }
  let mergedRules: PermissionRuleSet | undefined;
  try {
    mergedRules = await loadMergedPermissionRules({
      piwinRoot: rootDir,
      ...(permissionProjectPath ? { projectPath: permissionProjectPath } : {}),
      projectTrusted,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[piwin] permission rules unavailable: ${message}`);
  }

  // Bypass guard (ADR 0019 §3): `bypass` mode is refused for untrusted
  // projects so a freshly-cloned repo cannot disable prompts by editing its
  // own permissions.json. General scope (no project) keeps bypass — the user
  // is the trust authority there. The downgrade only narrows the effective
  // mode; rules + allowlists still apply.
  const configuredMode =
    adapterOptions.permissionModeOverride ?? config.permissions?.mode ?? 'auto';
  const isProjectScope = location.scope.kind === 'project';
  const guard = resolveBypassGuard(configuredMode, isProjectScope, projectTrusted);
  if (guard.downgraded) {
    const warnMessage =
      `[piwin] bypass permission mode refused for untrusted project ` +
      `${permissionProjectPath}; downgrading to 'auto'. Trust the project to enable bypass.`;
    console.warn(warnMessage);
    adapterOptions.onLog?.(warnMessage, 'warn');
  }
  const effectivePermissionMode: PermissionMode = guard.effectiveMode;

  // MCP session bridge (best-effort; failures become warnings)
  const mcpBridge = await createMcpSessionBridge({
    piwinRoot: rootDir,
    sessionId,
    ...(adapterOptions.lifecycleManager
      ? { lifecycleManager: adapterOptions.lifecycleManager }
      : {}),
    ...(mergedRules ? { rules: mergedRules } : {}),
    ...(requestPermission ? { requestPermission } : {}),
  });
  for (const warning of mcpBridge.warnings) {
    console.warn(`[piwin] ${warning}`);
  }

  const planTool = createPlanStepTool({
    sessionId,
    planPath: getPiwinSessionPlanPath(rootDir, sessionId),
  });
  const planCreateTool = createPlanCreateTool({
    sessionId,
    projectPath: agentCwd,
    planPath: getPiwinSessionPlanPath(rootDir, sessionId),
  });
  // Subagent delegation tool: only when host injected spawn/merge seams and
  // this session is not itself a readonly subagent (depth max 1, no nesting).
  const subagentRunTool =
    adapterOptions.onSpawnSubagent && adapterOptions.onMergeSubagent && !readonlySubagent
      ? createSubagentRunTool({
          sessionId,
          seam: {
            spawn: adapterOptions.onSpawnSubagent,
            merge: adapterOptions.onMergeSubagent,
          },
        })
      : undefined;

  // image_gen tool: only when the imagegen skill is enabled (switch = disabledIds).
  const imagegenDisabled = config.skills?.disabledIds?.includes('imagegen') ?? false;
  const imageGenTool = imagegenDisabled
    ? null
    : buildImageGenTool({
        piwinRoot: rootDir,
        sessionId,
        config,
        mediaConfig: {
          mediaRoot: getPiwinMediaDir(rootDir),
          maxPasteBytes: config.media.maxPasteBytes,
          allowedMimeTypes: config.media.allowedMimeTypes,
        },
        secretResolver: createSecretResolver(),
        ...(mergedRules ? { rules: mergedRules } : {}),
        ...(permissionHandler
          ? {
              requestPermission: wrapPermissionHandler(
                permissionHandler,
                sessionId,
                permissionProjectPath,
              ),
            }
          : {}),
      });

  // CE-PROC managed process tools (shared registry with HostRuntime when provided).
  let processRegistry = adapterOptions.processRegistry;
  if (!processRegistry) {
    const configProcess = config.process;
    processRegistry = createProcessRegistry({
      ...(configProcess ? { config: configProcess } : {}),
      getTrustedProjectRoots: async () => {
        try {
          const projects = await listProjects(getPiwinProjectsPath(rootDir));
          return projects
            .filter((project) => project.trust === 'trusted')
            .map((project) => project.path);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          console.warn(`[piwin] trusted project roots read failed: ${detail}`);
          return [];
        }
      },
    });
  }
  const processToolOptions: import('./process-tools.js').BuildProcessToolsOptions = {
    registry: processRegistry,
    projectPath: agentCwd,
    sessionId,
  };
  if (requestPermission) {
    processToolOptions.requestPermission = requestPermission;
  }
  // readonly sub-agents: no process_start (long-running writers)
  const processTools = readonlySubagent ? [] : buildProcessTools(processToolOptions);

  // Notes library tools (ADR 0018). Default enabled; FTS-only until embedding configured.
  const notesEnabled = config.notes?.enabled !== false;
  let notesTools: import('@piwin/tools-web').HostToolDefinition[] = [];
  let notesIndexCleanup: (() => void) | null = null;
  if (notesEnabled) {
    const noteStore = createNoteStore({ piwinRoot: rootDir });
    const noteIndex = await openNoteIndex(noteStore);
    notesIndexCleanup = () => noteIndex.close();
    const notesToolOptions: import('./notes-tools.js').BuildNotesToolsOptions = {
      store: noteStore,
      index: noteIndex,
      enabled: true,
    };
    if (config.notes?.embedding) {
      const apiKey = await resolveNotesEmbeddingApiKey(config.notes.embedding);
      const provider = createEmbeddingProvider({
        config: config.notes.embedding,
        ...(apiKey ? { apiKey } : {}),
      });
      if (provider) {
        notesToolOptions.embeddingProvider = provider;
      }
    }
    if (typeof config.notes?.search?.rrfK === 'number') {
      notesToolOptions.rrfK = config.notes.search.rrfK;
    }
    {
      const { buildNotesRerankProvider } = await import('./notes-rerank.js');
      const rerank = await buildNotesRerankProvider(config);
      if (rerank) {
        notesToolOptions.rerankProvider = rerank;
      }
    }
    if (requestPermission) {
      notesToolOptions.requestPermission = requestPermission;
    }
    notesTools = buildNotesTools(notesToolOptions);
  }

  // Flashcard tools (ADR 0018 §7, doc-flashcards §10).
  const flashcardsEnabled = config.flashcards?.enabled !== false;
  let flashcardTools: import('@piwin/tools-web').HostToolDefinition[] = [];
  if (flashcardsEnabled) {
    const cardStore = createCardStore({ piwinRoot: rootDir });
    const flashcardToolOptions: import('./flashcard-tools.js').BuildFlashcardToolsOptions = {
      store: cardStore,
      enabled: true,
      ...(typeof config.flashcards?.maxBatchSize === 'number'
        ? { maxBatchSize: config.flashcards.maxBatchSize }
        : {}),
    };
    if (requestPermission) {
      flashcardToolOptions.requestPermission = requestPermission;
    }
    flashcardTools = buildFlashcardTools(flashcardToolOptions);
  }

  // Browser session tools (ADR 0020). Appended to the tool set when a
  // host-owned BrowserSession is available. The navigate tool is
  // permission-gated inside its executor.
  const browserSession = adapterOptions.getBrowserSession?.();
  const browserTools: import('@piwin/tools-web').HostToolDefinition[] = [];
  if (browserSession && !readonlySubagent) {
    const browserToolOptions: import('./browser-tools.js').CreateBrowserToolsOptions = {};
    if (requestPermission) {
      browserToolOptions.requestPermission = requestPermission;
    }
    if (mergedRules) {
      browserToolOptions.rules = mergedRules;
    }
    browserTools.push(...createBrowserToolDefinitions(browserSession, browserToolOptions));
  }

  // Unified tool set: all tools available in every session.
  const hostTools: import('@piwin/tools-web').HostToolDefinition[] = [
    ...webTools,
    ...mcpBridge.tools,
    planTool,
    planCreateTool,
    ...processTools,
    ...notesTools,
    ...flashcardTools,
    ...(subagentRunTool ? [subagentRunTool] : []),
    ...(imageGenTool ? [imageGenTool] : []),
    ...browserTools,
  ];
  const customTools = toPiCustomTools(hostTools);

  // Replace built-in bash with permission-gated bash (hard-deny + ask UI).
  if (!readonlySubagent) {
    try {
      const gatedBashOptions: {
        cwd: string;
        projectsFilePath: string;
        projectPath: string;
        requestPermission?: (request: {
          action: string;
          detail: string;
          defaultDecision: PermissionDecision;
          signal?: AbortSignal;
        }) => Promise<PermissionDecision>;
      } = {
        cwd: agentCwd,
        projectsFilePath,
        projectPath: permissionProjectPath,
      };
      if (permissionHandler) {
        gatedBashOptions.requestPermission = wrapPermissionHandler(
          permissionHandler,
          sessionId,
          permissionProjectPath,
        );
      }
      const gatedBash = await buildGatedBashToolDefinition(gatedBashOptions);
      customTools.push(gatedBash as (typeof customTools)[number]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[piwin] gated bash unavailable: ${message}`);
    }

    // Replace built-in write/edit with permission-gated versions (ADR 0019 §4).
    // Closes the largest blind spot: Pi's native file tools are otherwise ungated.
    try {
      // mergedRules + projectTrusted were loaded above (shared with MCP bridge).
      const gatedFileOptions: {
        cwd: string;
        mode: 'auto' | 'ask-all' | 'bypass';
        rules: PermissionRuleSet;
        projectRoot: string;
        projectsFilePath: string;
        requestPermission?: (request: {
          action: string;
          detail: string;
          defaultDecision: PermissionDecision;
          signal?: AbortSignal;
        }) => Promise<PermissionDecision>;
      } = {
        cwd: agentCwd,
        mode: effectivePermissionMode,
        rules: mergedRules ?? createBundledRuleSet(),
        projectRoot: permissionProjectPath,
        projectsFilePath,
      };
      if (permissionHandler) {
        gatedFileOptions.requestPermission = wrapPermissionHandler(
          permissionHandler,
          sessionId,
          permissionProjectPath,
        );
      }
      const gatedFileTools = await buildGatedFileToolsDefinition(gatedFileOptions);
      for (const tool of gatedFileTools) {
        customTools.push(tool as (typeof customTools)[number]);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[piwin] gated file tools unavailable: ${message}`);
    }
  }

  const extraSkillPaths = config.skills?.extraPaths ?? [];
  const disabledSkillIds = config.skills?.disabledIds ?? [];
  const extraExtensionPaths = config.extensions?.extraPaths ?? [];
  const disabledExtensionIds = config.extensions?.disabledIds ?? [];
  const extraPromptPaths = config.prompts?.extraPaths ?? [];
  const disabledPromptIds = config.prompts?.disabledIds ?? [];
  const { resourceLoader, skillPaths, extensionPaths, promptPaths } = await createPiResourceLoader({
    cwd: agentCwd,
    agentDir,
    piwinRoot: rootDir,
    scope: location.scope,
    // General: never walk project-local skill/extension/prompt trees.
    ...(location.scope.kind === 'project' ? { projectPath: location.scope.projectPath } : {}),
    ...(extraSkillPaths.length > 0 ? { extraSkillPaths } : {}),
    ...(disabledSkillIds.length > 0 ? { disabledSkillIds } : {}),
    ...(extraExtensionPaths.length > 0 ? { extraExtensionPaths } : {}),
    ...(disabledExtensionIds.length > 0 ? { disabledExtensionIds } : {}),
    ...(extraPromptPaths.length > 0 ? { extraPromptPaths } : {}),
    ...(disabledPromptIds.length > 0 ? { disabledPromptIds } : {}),
  });

  const sessionOptions: Record<string, unknown> = {
    cwd: agentCwd,
    agentDir,
    // Gated bash is registered as customTools name "bash" and overrides the built-in.
    customTools,
    resourceLoader,
  };

  const modelRuntime = await createPiModelRuntime(piModule, config, agentDir);
  const requestedModel =
    input.model ??
    (config.defaultProviderId && config.defaultModelId
      ? {
          protocol: config.providers.find((provider) => provider.id === config.defaultProviderId)
            ?.protocol,
          providerId: config.defaultProviderId,
          modelId: config.defaultModelId,
        }
      : undefined);
  if (requestedModel?.protocol) {
    const selectedModel = modelRuntime.getModel(requestedModel.providerId, requestedModel.modelId);
    if (!selectedModel) {
      throw new Error(
        `Configured model is unavailable: ${requestedModel.providerId}/${requestedModel.modelId}`,
      );
    }
    sessionOptions.model = selectedModel;
  }
  sessionOptions.modelRuntime = modelRuntime;

  const result = (await (
    createAgentSession as (options: Record<string, unknown>) => Promise<unknown>
  )(sessionOptions)) as { session?: PiLikeSession };

  const piSession = result.session;
  if (!piSession) {
    await mcpBridge.close();
    throw new Error('createAgentSession returned no session');
  }

  if (adapterOptions.onExtensionUiRequest) {
    const uiContext = createExtensionUiContext(
      sessionId,
      {
        request: async (request) =>
          adapterOptions.onExtensionUiRequest!({
            ...request,
            sessionId,
          }),
        ...(adapterOptions.onExtensionNotify ? { notify: adapterOptions.onExtensionNotify } : {}),
      },
      () => cryptoRandomId(),
    );
    try {
      const bound = await bindExtensionUiToPiSession(
        piSession as { bindExtensions?: (bindings: Record<string, unknown>) => Promise<void> },
        uiContext,
      );
      if (bound) {
        console.info('[piwin] extension UI bridge bound (mode=rpc hasUI)');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[piwin] extension UI bridge bind failed: ${message}`);
    }
  }

  console.info(
    `[piwin] session tools custom=${customTools.length} (web=${webTools.length}, mcp=${mcpBridge.toolCount}) skills=${skillPaths.length} extensions=${extensionPaths.length} prompts=${promptPaths.length}`,
  );

  const handle = wrapPiSession(piSession, sessionId, modelRuntime);
  // Attach cleanup via weak side channel on handle id — stored by adapter after return.
  (handle as SessionHandle & { __piwinCleanup?: () => Promise<void> }).__piwinCleanup =
    async () => {
      notesIndexCleanup?.();
      await mcpBridge.close();
    };
  return handle;
}

async function createPiModelRuntime(
  piModule: Record<string, unknown>,
  config: Awaited<ReturnType<typeof loadPiwinConfig>>,
  agentDir: string,
): Promise<PiModelRuntime> {
  const runtimeConstructor = piModule.ModelRuntime as
    | {
        create: (options: { authPath: string; modelsPath: string }) => Promise<PiModelRuntime>;
      }
    | undefined;
  if (!runtimeConstructor?.create) {
    throw new Error('Pi ModelRuntime export missing from @earendil-works/pi-coding-agent');
  }

  const modelRuntime = await runtimeConstructor.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  });
  const secretResolver = createSecretResolver();

  for (const provider of config.providers) {
    let apiKey: string | undefined;
    try {
      const resolved = await secretResolver.resolveProviderSecret(provider);
      if (resolved) {
        apiKey = resolved;
      }
    } catch {
      // Keep the provider registered so Pi can report a precise unavailable
      // model error instead of silently dropping it from the model catalog.
    }
    modelRuntime.registerProvider(provider.id, buildPiProviderRegistration(provider, apiKey));
  }
  await modelRuntime.refresh({ allowNetwork: false });
  return modelRuntime;
}

function applyProviderEnv(config: Awaited<ReturnType<typeof loadPiwinConfig>>): void {
  for (const provider of config.providers) {
    if (provider.apiKeyEnv && process.env[provider.apiKeyEnv]) {
      // env already set by user
      continue;
    }
    // Map common defaults so Pi built-in providers can see keys
    if (provider.protocol === 'openai-compatible' && process.env.OPENAI_API_KEY) {
      continue;
    }
    if (provider.protocol === 'anthropic-compatible' && process.env.ANTHROPIC_API_KEY) {
      continue;
    }
  }

  const hasOpenAi =
    Boolean(process.env.OPENAI_API_KEY) ||
    config.providers.some(
      (provider) =>
        provider.protocol === 'openai-compatible' &&
        provider.apiKeyEnv &&
        Boolean(process.env[provider.apiKeyEnv]),
    );
  const hasAnthropic =
    Boolean(process.env.ANTHROPIC_API_KEY) ||
    config.providers.some(
      (provider) =>
        provider.protocol === 'anthropic-compatible' &&
        provider.apiKeyEnv &&
        Boolean(process.env[provider.apiKeyEnv]),
    );

  if (!hasOpenAi && !hasAnthropic && config.providers.length === 0) {
    throw new Error(
      'No provider API keys found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY, ' +
        'or add providers[] with apiKeyEnv in ~/.piwin/config.json',
    );
  }
}

type PiLikeSession = {
  sessionId?: string;
  sessionFile?: string;
  prompt: (text: string, options?: unknown) => Promise<void>;
  steer?: (text: string) => Promise<void>;
  followUp?: (text: string) => Promise<void>;
  abort?: () => Promise<void>;
  compact?: (customInstructions?: string) => Promise<unknown>;
  abortCompaction?: () => void;
  setAutoCompactionEnabled?: (enabled: boolean) => void;
  autoCompactionEnabled?: boolean;
  /** Optional per-turn model switch (Pi SDK when present). */
  setModel?: (model: PiModelRegistration) => Promise<void> | void;
  setThinkingLevel?: (level: string) => Promise<void> | void;
  subscribe: (listener: (event: unknown) => void) => () => void;
};

function wrapPiSession(
  piSession: PiLikeSession,
  forcedId: string | undefined,
  modelRuntime: PiModelRuntime,
): SessionHandle {
  const sessionId = forcedId ?? piSession.sessionId ?? cryptoRandomId();
  const eventMapper = createPiSessionEventMapper();

  return {
    id: sessionId,
    async prompt(promptInput) {
      // Apply per-turn profile when the installed SDK exposes setters.
      if (promptInput.thinkingLevel && piSession.setThinkingLevel) {
        await piSession.setThinkingLevel(
          mapThinkingLevelToApi(promptInput.thinkingLevel, promptInput.model?.protocol),
        );
      }
      if (promptInput.model && piSession.setModel) {
        try {
          const model = modelRuntime.getModel(
            promptInput.model.providerId,
            promptInput.model.modelId,
          );
          if (!model) {
            throw new Error(
              `Configured model is unavailable: ${promptInput.model.providerId}/${promptInput.model.modelId}`,
            );
          }
          await piSession.setModel(model);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`model-unavailable: cannot switch model for this turn (${message})`);
        }
      } else if (promptInput.model && !piSession.setModel) {
        // Product history is re-injected by session-live-commands; continue without silent drop.
        // Callers that require a hard switch must rebuild the live handle (ensureLiveSession).
      }
      await piSession.prompt(promptInput.text);
    },
    async steer(message) {
      if (piSession.steer) {
        await piSession.steer(message);
        return;
      }
      throw new Error('Pi session does not support steer');
    },
    async followUp(message) {
      if (piSession.followUp) {
        await piSession.followUp(message);
        return;
      }
      await piSession.prompt(message);
    },
    async abort() {
      if (piSession.abort) {
        await piSession.abort();
      }
    },
    async compact(customInstructions?: string) {
      if (!piSession.compact) {
        return { ok: false, message: 'Pi session does not support compact' };
      }
      const startedAt = Date.now();
      try {
        const result = await piSession.compact(customInstructions);
        const durationMs = Date.now() - startedAt;
        return mapPiCompactResult(result, durationMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, message, durationMs: Date.now() - startedAt };
      }
    },
    abortCompaction() {
      if (piSession.abortCompaction) {
        piSession.abortCompaction();
      }
    },
    getAutoCompactionEnabled() {
      return Boolean(piSession.autoCompactionEnabled);
    },
    setAutoCompactionEnabled(enabled: boolean) {
      if (piSession.setAutoCompactionEnabled) {
        piSession.setAutoCompactionEnabled(enabled);
      }
    },
    async getMessages() {
      return [];
    },
    async getTree() {
      return { root: null, activeLeafId: null };
    },
    subscribe(listener) {
      return piSession.subscribe((raw) => {
        for (const wrapped of eventMapper.map(raw)) {
          listener(wrapped.event);
        }
      });
    },
  };
}

function mapPiCompactResult(
  result: unknown,
  durationMs: number,
): import('@piwin/contracts').SessionCompactResult {
  const out: import('@piwin/contracts').SessionCompactResult = {
    ok: true,
    durationMs,
  };
  if (!result || typeof result !== 'object') {
    out.message = 'Compaction finished';
    return out;
  }
  const record = result as Record<string, unknown>;
  if (typeof record.message === 'string' && record.message) {
    out.message = record.message;
  }
  if (typeof record.summary === 'string' && record.summary) {
    out.summary = record.summary;
    if (!out.message) {
      out.message = record.summary.slice(0, 200);
    }
  }
  if (typeof record.tokensBefore === 'number' && Number.isFinite(record.tokensBefore)) {
    out.tokensBefore = record.tokensBefore;
  }
  if (
    typeof record.estimatedTokensAfter === 'number' &&
    Number.isFinite(record.estimatedTokensAfter)
  ) {
    out.tokensAfter = record.estimatedTokensAfter;
  } else if (typeof record.tokensAfter === 'number' && Number.isFinite(record.tokensAfter)) {
    out.tokensAfter = record.tokensAfter;
  }
  if (!out.message) {
    out.message = 'Compaction finished';
  }
  const fileOps = extractFileOpsFromUnknown(result);
  if (fileOps) {
    out.fileOps = fileOps;
  }
  return out;
}

function cryptoRandomId(): string {
  return `sdk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Pure decision for the bypass guard (ADR 0019 §3). `bypass` is refused for
 * untrusted projects so a freshly-cloned repo cannot disable prompts by
 * editing its own permissions.json. General scope (no project) keeps bypass
 * — the user is the trust authority there. Non-bypass modes pass through
 * unchanged.
 */
export function resolveBypassGuard(
  configuredMode: PermissionMode,
  isProjectScope: boolean,
  projectTrusted: boolean,
): { effectiveMode: PermissionMode; downgraded: boolean } {
  if (configuredMode === 'bypass' && isProjectScope && !projectTrusted) {
    return { effectiveMode: 'auto', downgraded: true };
  }
  return { effectiveMode: configuredMode, downgraded: false };
}

export function createSdkAdapterFromHostOptions(
  options: AgentHostFactoryOptions,
  mock?: boolean,
): PiSdkAdapter {
  const sdkOptions: PiSdkAdapterOptions = {};
  if (typeof options.piwinRoot === 'string') {
    sdkOptions.piwinRoot = options.piwinRoot;
  }
  if (typeof mock === 'boolean') {
    sdkOptions.mock = mock;
  }
  return new PiSdkAdapter(sdkOptions);
}
