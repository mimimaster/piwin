import type {
  AgentHost,
  AgentHostFactoryOptions,
  CreateSessionInput,
  PermissionDecision,
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
} from './paths.js';
import { createPlanStepTool } from './plan-step-tool.js';
import { buildSessionTools } from './session-tools.js';
import { toPiCustomTools } from './pi-tool-adapter.js';
import { createPiResourceLoader } from './pi-resource-loader.js';
import {
  bindExtensionUiToPiSession,
  createExtensionUiContext,
} from './extension-ui-bridge.js';
import { createMcpSessionBridge } from './mcp-session-bridge.js';
import { buildGatedBashToolDefinition } from './gated-bash-tool.js';
import { buildProcessTools } from './process-tools.js';
import { createNoteStore, openNoteIndex, createEmbeddingProvider } from '@piwin/notes';
import { buildNotesTools } from './notes-tools.js';
import { resolveNotesEmbeddingApiKey } from './notes-embedding-secret.js';
import { createCardStore } from '@piwin/flashcards';
import { buildFlashcardTools } from './flashcard-tools.js';
import { createSecretResolver } from './secret-resolver.js';
import {
  buildPiProviderRegistration,
  type PiModelRuntime,
  type PiModelRegistration,
} from './pi-model-runtime.js';
import { listProjects } from '@piwin/project';
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

export type PiSdkAdapterOptions = {
  piwinRoot?: string;
  /** Force mock sessions (no Pi dependency). */
  mock?: boolean;
  onPermissionRequest?: (
    request: PiSdkPermissionRequest,
  ) => Promise<PermissionDecision>;
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
  onExtensionNotify?: (
    message: string,
    level: 'info' | 'warning' | 'error',
  ) => void;
  /** Shared CE-PROC registry from HostRuntime; adapter owns one if omitted. */
  processRegistry?: ProcessRegistry;
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
      await this.persistSessionMeta(session.id, location.scope, location.workingDirectory, input.sessionName);
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
      await this.persistSessionMeta(session.id, location.scope, location.workingDirectory, input.sessionName);
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
    const location = await resolveSessionLocation({ scope, projectPath: record.projectPath }, this.options.piwinRoot);

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
    const fallbackProjectPath =
      fallbackScope.kind === 'project' ? fallbackScope.projectPath : '';
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
      this.ownedLifecycleManager = createMcpLifecycleManager(
        getPiwinRoot(this.options.piwinRoot),
      );
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
    await upsertSessionRecord(indexPath, record);
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

  // MCP session bridge (best-effort; failures become warnings)
  const mcpBridge = await createMcpSessionBridge({
    piwinRoot: rootDir,
    sessionId,
    ...(adapterOptions.lifecycleManager
      ? { lifecycleManager: adapterOptions.lifecycleManager }
      : {}),
    ...(requestPermission ? { requestPermission } : {}),
  });
  for (const warning of mcpBridge.warnings) {
    console.warn(`[piwin] ${warning}`);
  }

  const planTool = createPlanStepTool({
    sessionId,
    planPath: getPiwinSessionPlanPath(rootDir, sessionId),
  });
  const executionMode = input.executionMode ?? 'agent';
  const chatMode = executionMode === 'chat';

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
        } catch {
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
  const processTools = chatMode || readonlySubagent ? [] : buildProcessTools(processToolOptions);

  // Notes library tools (ADR 0018). Default enabled; FTS-only until embedding configured.
  // Knowledge profile (chat) gets read-only notes tools; coding profile (agent)
  // gets full CRUD. See doc-flashcards §10.2.
  const notesEnabled = config.notes?.enabled !== false;
  let notesTools: import('@piwin/tools-web').HostToolDefinition[] = [];
  let notesSearchOnlyTools: import('@piwin/tools-web').HostToolDefinition[] = [];
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
    notesSearchOnlyTools = buildNotesTools({ ...notesToolOptions, readOnly: true });
  }

  // Flashcard tools (ADR 0018 §7, doc-flashcards §10).
  // Knowledge profile (chat): enabled. Coding profile (agent): disabled unless
  // config.flashcards.agentModeTools is true. Debug profile: enabled.
  const flashcardsEnabled = config.flashcards?.enabled !== false;
  const flashcardsInCoding = config.flashcards?.agentModeTools === true;
  const flashcardsInKnowledge = flashcardsEnabled;
  const flashcardsInDebug = flashcardsEnabled;
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

  // Tool profiles by ExecutionMode (doc-flashcards §10.2).
  // - knowledge (chat): flashcards + read-only notes + optional web
  // - coding (agent): web/mcp/plan/process/notes CRUD, no flashcards (unless agentModeTools)
  // - debug (agent-debug): coding ∪ flashcards
  const knowledgeTools: import('@piwin/tools-web').HostToolDefinition[] = [
    ...flashcardTools,
    ...notesSearchOnlyTools,
    ...(flashcardsInKnowledge ? webTools : []),
  ];
  const codingTools: import('@piwin/tools-web').HostToolDefinition[] = [
    ...webTools,
    ...mcpBridge.tools,
    planTool,
    ...processTools,
    ...notesTools,
    ...(flashcardsInCoding ? flashcardTools : []),
  ];
  const hostTools =
    executionMode === 'chat'
      ? knowledgeTools
      : executionMode === 'agent-debug'
        ? [...codingTools, ...flashcardTools]
        : codingTools;
  const customTools = toPiCustomTools(hostTools);

  // Replace built-in bash with permission-gated bash (hard-deny + ask UI).
  if (!chatMode && !readonlySubagent) {
    try {
      const gatedBashOptions: {
        cwd: string;
        requestPermission?: (request: {
          action: string;
          detail: string;
          defaultDecision: PermissionDecision;
          signal?: AbortSignal;
        }) => Promise<PermissionDecision>;
      } = { cwd: agentCwd };
      if (permissionHandler) {
        gatedBashOptions.requestPermission = async (gateInput) =>
          permissionHandler({
            sessionId,
            projectPath: permissionProjectPath,
            action: gateInput.action,
            detail: gateInput.detail,
            defaultDecision: gateInput.defaultDecision,
            ...(gateInput.signal ? { signal: gateInput.signal } : {}),
          });
      }
      const gatedBash = await buildGatedBashToolDefinition(gatedBashOptions);
      customTools.push(gatedBash as (typeof customTools)[number]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[piwin] gated bash unavailable: ${message}`);
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
    ...(location.scope.kind === 'project'
      ? { projectPath: location.scope.projectPath }
      : {}),
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
  const requestedModel = input.model ?? (
    config.defaultProviderId && config.defaultModelId
      ? {
          protocol: config.providers.find(
            (provider) => provider.id === config.defaultProviderId,
          )?.protocol,
          providerId: config.defaultProviderId,
          modelId: config.defaultModelId,
        }
      : undefined
  );
  if (requestedModel?.protocol) {
    const selectedModel = modelRuntime.getModel(
      requestedModel.providerId,
      requestedModel.modelId,
    );
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
        ...(adapterOptions.onExtensionNotify
          ? { notify: adapterOptions.onExtensionNotify }
          : {}),
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
    `[piwin] session tools mode=${executionMode} custom=${customTools.length} (web=${webTools.length}, mcp=${mcpBridge.toolCount}) skills=${skillPaths.length} extensions=${extensionPaths.length} prompts=${promptPaths.length}`,
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
        create: (options: {
          authPath: string;
          modelsPath: string;
        }) => Promise<PiModelRuntime>;
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
    modelRuntime.registerProvider(
      provider.id,
      buildPiProviderRegistration(provider, apiKey),
    );
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
          throw new Error(
            `model-unavailable: cannot switch model for this turn (${message})`,
          );
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
