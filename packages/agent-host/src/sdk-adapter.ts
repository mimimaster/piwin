import type {
  AgentHost,
  AgentHostFactoryOptions,
  CreateSessionInput,
  PermissionDecision,
  SessionHandle,
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
import { mapPiSessionEvent } from './event-map.js';
import { loadPiwinConfig } from './config-store.js';
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
import { createMemoryStore, projectKeyFromPath } from '@piwin/memory';
import { buildMemoryTools } from './memory-tools.js';
import { listProjects } from '@piwin/project';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type PiSdkPermissionRequest = {
  sessionId: string;
  action: string;
  detail: string;
  defaultDecision: PermissionDecision;
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
    if (useMock) {
      const session = createMockSessionHandle(input);
      this.sessions.set(session.id, session);
      await this.persistSessionMeta(session.id, input.projectPath, input.sessionName);
      return session;
    }

    try {
      const session = await createPiSdkSession(input, this.sessionAdapterOptions());
      this.sessions.set(session.id, session);
      const cleanup = (session as SessionHandle & { __piwinCleanup?: () => Promise<void> })
        .__piwinCleanup;
      if (cleanup) {
        this.sessionCleanups.set(session.id, cleanup);
      }
      await this.persistSessionMeta(session.id, input.projectPath, input.sessionName);
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

    if (useMock) {
      const mockOptions: Parameters<typeof createMockSessionHandle>[0] = {
        projectPath: record.projectPath,
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
      projectPath: record.projectPath,
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

  async listSessions(projectPath: string): Promise<SessionSummary[]> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    try {
      const indexed = await listSessionsForProject(indexPath, projectPath);
      if (indexed.length > 0) {
        return indexed.map((item) => {
          const summary: SessionSummary = {
            id: item.id,
            projectPath: item.projectPath,
            updatedAt: item.updatedAt,
            messageCount: item.messageCount,
          };
          if (item.name) {
            summary.name = item.name;
          }
          return summary;
        });
      }
    } catch {
      // fall through to in-memory
    }
    const now = new Date().toISOString();
    return [...this.sessions.entries()].map(([id]) => ({
      id,
      projectPath,
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
    projectPath: string,
    sessionName?: string,
  ): Promise<void> {
    const rootDir = getPiwinRoot(this.options.piwinRoot);
    const indexPath = getPiwinSessionIndexPath(rootDir);
    const record = createSessionRecord({
      id: sessionId,
      projectPath,
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
      }) =>
        permissionHandler({
          sessionId,
          action: gateInput.action,
          detail: gateInput.detail,
          defaultDecision: gateInput.defaultDecision,
        })
    : undefined;

  const toolBuildOptions: import('./session-tools.js').BuildSessionToolsOptions = {
    projectPath: input.projectPath,
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
    projectPath: input.projectPath,
    projectsFilePath: getPiwinProjectsPath(rootDir),
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
    projectPath: input.projectPath,
    sessionId,
  };
  if (requestPermission) {
    processToolOptions.requestPermission = requestPermission;
  }
  const processTools = chatMode ? [] : buildProcessTools(processToolOptions);

  const memoryEnabled = config.memory?.enabled === true;
  const memoryStore = createMemoryStore({
    piwinRoot: rootDir,
    ...(typeof config.memory?.maxOverviewChars === 'number'
      ? { maxOverviewChars: config.memory.maxOverviewChars }
      : {}),
  });
  const memoryToolOptions: import('./memory-tools.js').BuildMemoryToolsOptions = {
    store: memoryStore,
    enabled: memoryEnabled && !chatMode,
    defaultProjectKey: projectKeyFromPath(input.projectPath),
  };
  if (requestPermission) {
    memoryToolOptions.requestPermission = requestPermission;
  }
  const memoryTools = buildMemoryTools(memoryToolOptions);

  // CE-MODE light: chat strips host custom tools and gated bash.
  const hostTools = chatMode
    ? []
    : [...webTools, ...mcpBridge.tools, planTool, ...processTools, ...memoryTools];
  const customTools = toPiCustomTools(hostTools);

  // Replace built-in bash with permission-gated bash (hard-deny + ask UI).
  if (!chatMode) {
    try {
      const gatedBashOptions: {
        cwd: string;
        requestPermission?: (request: {
          action: string;
          detail: string;
          defaultDecision: PermissionDecision;
        }) => Promise<PermissionDecision>;
      } = { cwd: input.projectPath };
      if (permissionHandler) {
        gatedBashOptions.requestPermission = async (gateInput) =>
          permissionHandler({
            sessionId,
            action: gateInput.action,
            detail: gateInput.detail,
            defaultDecision: gateInput.defaultDecision,
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
    cwd: input.projectPath,
    agentDir,
    piwinRoot: rootDir,
    projectPath: input.projectPath,
    ...(extraSkillPaths.length > 0 ? { extraSkillPaths } : {}),
    ...(disabledSkillIds.length > 0 ? { disabledSkillIds } : {}),
    ...(extraExtensionPaths.length > 0 ? { extraExtensionPaths } : {}),
    ...(disabledExtensionIds.length > 0 ? { disabledExtensionIds } : {}),
    ...(extraPromptPaths.length > 0 ? { extraPromptPaths } : {}),
    ...(disabledPromptIds.length > 0 ? { disabledPromptIds } : {}),
  });

  const sessionOptions: Record<string, unknown> = {
    cwd: input.projectPath,
    agentDir,
    // Gated bash is registered as customTools name "bash" and overrides the built-in.
    customTools,
    resourceLoader,
  };

  if (input.model) {
    sessionOptions.modelId = input.model.modelId;
    sessionOptions.provider = input.model.providerId;
  } else if (config.defaultModelId) {
    sessionOptions.modelId = config.defaultModelId;
  }

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
    `[piwin] session tools mode=${executionMode} custom=${customTools.length} (web=${webTools.length}, mcp=${mcpBridge.toolCount}, memory=${memoryTools.length}) skills=${skillPaths.length} extensions=${extensionPaths.length} prompts=${promptPaths.length}`,
  );

  const handle = wrapPiSession(piSession, sessionId);
  // Attach cleanup via weak side channel on handle id — stored by adapter after return.
  (handle as SessionHandle & { __piwinCleanup?: () => Promise<void> }).__piwinCleanup =
    async () => {
      await mcpBridge.close();
    };
  return handle;
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
  subscribe: (listener: (event: unknown) => void) => () => void;
};

function wrapPiSession(piSession: PiLikeSession, forcedId?: string): SessionHandle {
  const sessionId = forcedId ?? piSession.sessionId ?? cryptoRandomId();

  return {
    id: sessionId,
    async prompt(promptInput) {
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
        for (const event of mapPiSessionEvent(raw)) {
          listener(event);
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
