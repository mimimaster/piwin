import type {
  AgentHost,
  AgentEvent,
  CreateSessionInput,
  CreateSessionOptions,
  HostToolExecutionPort,
  HostToolDescriptor,
  PromptInput,
  SessionHandle,
  SessionScope,
  SessionSummary,
  SessionTreeView,
  AgentMessageView,
  McpConfigDocument,
  ModelRef,
  SessionToolFamily,
} from '@piwin/contracts';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
import {
  InProcessSdkSessionBackend,
  AgentWorkerSupervisor,
  WorkerSessionBackend,
  type BackendSessionHandle,
  type PiSessionBackend,
} from '@piwin/agent-host';
import { createMockSessionHandle } from './mock-session.js';
import { compileBlueprintForWorker } from './blueprint-compiler.js';
import { loadPromptImages } from './prompt-images.js';
import { loadPiwinConfig } from './config-store.js';
import { createSettingsSnapshot } from './settings/settings-service.js';

export type ProductAgentHostToolRegistrationMode = 'active' | 'pending';

export type PreparedProductSession = {
  session: SessionHandle;
  sessionId: string;
  runtimeGenerationId: string;
  settingsRevision: string;
  extensionSetRevision?: string;
  registrationMode: ProductAgentHostToolRegistrationMode;
  /** Whether the backend already owns reconstructed native/product history. */
  historySeeded: boolean;
};

type ProductAgentHostCommonOptions = {
  mode: 'sdk' | 'rpc';
  piwinRoot?: string;
  onGenerationCreated?: (
    sessionId: string,
    generationId: string,
    settingsRevision: string,
    extensionSetRevision?: string,
  ) => void;
  onGenerationDetached?: (sessionId: string) => void | Promise<void>;
  /**
   * Resolve whether a project path is trusted. When provided, the compiler
   * calls this to gate write/process/bash/delegate capabilities. When
   * omitted, the compiler assumes trusted (backward compat).
   */
  trustResolver?: (projectPath: string) => Promise<boolean>;
  /** Shared supervisor supplied by HostRuntime for RPC foreground sessions. */
  workerSupervisor?: AgentWorkerSupervisor;
  /** Current Run identity, supplied by HostRuntime's execution context. */
  getCurrentRunId?: () => string | undefined;
  getSubscriptionCompileContext?: () => Promise<{
    usableSubscriptionProviderIds: readonly string[];
    subscriptionAccounts: import('./resolve-chat-model.js').ResolveChatModelAccounts;
  }>;
  /** Derive the host-local family index from the same registrations as descriptors. */
  buildToolFamilyIndex?: (
    sessionId: string,
    runtimeGenerationId: string,
    model?: ModelRef,
    mode?: ProductAgentHostToolRegistrationMode,
  ) => Promise<ReadonlyMap<SessionToolFamily, readonly string[]>>;
  /** Read the MCP document frozen for the same generation surface. */
  getMcpConfig?: (sessionId: string, runtimeGenerationId: string) => Promise<McpConfigDocument>;
  /** Read the MCP brief from the same frozen tool surface (no second discovery). */
  getMcpCapabilityBrief?: (
    sessionId: string,
    runtimeGenerationId: string,
  ) => Promise<McpCapabilityBrief>;
  /** Read the permission-rule revision frozen for the same generation surface. */
  getPermissionRulesRevision?: (
    sessionId: string,
    runtimeGenerationId: string,
  ) => string | undefined;
  /** Restrict the Host execution surface to the compiled manifest. */
  restrictToolSurface?: (
    sessionId: string,
    runtimeGenerationId: string,
    toolNames: readonly string[],
    toolboxTargetNames: readonly string[],
    mcpCatalogEnabled: boolean,
  ) => void;
};

export type ProductAgentHostOptions =
  | (ProductAgentHostCommonOptions & {
      mock: true;
      hostToolExecution?: never;
      buildToolDescriptors?: never;
    })
  | (ProductAgentHostCommonOptions & {
      mock: false;
      hostToolExecution: HostToolExecutionPort;
      restrictToolSurface: (
        sessionId: string,
        runtimeGenerationId: string,
        toolNames: readonly string[],
        toolboxTargetNames: readonly string[],
        mcpCatalogEnabled: boolean,
      ) => void;
      /**
       * Build concrete Host tool descriptors for a session. Called before
       * blueprint compilation so the compiled manifest carries real
       * descriptions and parameter schemas instead of name-only guesses.
       */
      buildToolDescriptors: (
        sessionId: string,
        runtimeGenerationId: string,
        model?: ModelRef,
        mode?: ProductAgentHostToolRegistrationMode,
      ) => Promise<HostToolDescriptor[]>;
    });

/**
 * Host-owned composition wrapper around the narrow Pi backend seam.
 *
 * Session indexing, prompt preparation, and product command routing remain in
 * HostRuntime. This class only turns a compiled backend handle into the
 * SessionHandle shape consumed by those product services.
 */
export class ProductAgentHost implements AgentHost {
  readonly mode: 'sdk' | 'rpc';
  private readonly options: ProductAgentHostOptions;
  private readonly backend: PiSessionBackend | null;
  private readonly ownedWorkerSupervisor: AgentWorkerSupervisor | null;
  private readonly sessions = new Map<string, SessionHandle>();

  constructor(options: ProductAgentHostOptions) {
    if (!options.mock && !options.hostToolExecution) {
      throw new Error(
        'ProductAgentHost requires a parent-owned HostToolExecutionPort in non-mock mode',
      );
    }
    if (!options.mock && !options.restrictToolSurface) {
      throw new Error(
        'ProductAgentHost requires a Host tool-surface restriction callback in non-mock mode',
      );
    }
    this.options = options;
    this.mode = options.mode;
    this.ownedWorkerSupervisor =
      !options.mock && options.mode === 'rpc' && !options.workerSupervisor
        ? new AgentWorkerSupervisor()
        : null;
    this.backend = options.mock
      ? null
      : options.mode === 'sdk'
        ? new InProcessSdkSessionBackend()
        : new WorkerSessionBackend({
            supervisor:
              options.workerSupervisor ?? this.ownedWorkerSupervisor ?? new AgentWorkerSupervisor(),
            disposeSupervisor: this.ownedWorkerSupervisor !== null,
          });
  }

  async createSession(
    input: CreateSessionInput,
    options: CreateSessionOptions = {},
  ): Promise<SessionHandle> {
    const sessionId = createProductSessionId();
    const runtimeGenerationId = createRuntimeGenerationId();
    return this.createSessionWithIdentity(input, sessionId, runtimeGenerationId, options);
  }

  /**
   * Prepare a candidate without replacing the active stable session. The
   * candidate gets its own backend generation and pending Host tool surface;
   * callers must commit or abort it explicitly.
   */
  async prepareSession(
    sessionId: string,
    input: CreateSessionInput,
    runtimeGenerationId: string,
    options: CreateSessionOptions = {},
  ): Promise<PreparedProductSession> {
    return this.prepareSessionWithIdentity(
      input,
      sessionId,
      runtimeGenerationId,
      'pending',
      options,
    );
  }

  /**
   * Cold activation (ADR 0040 §7): create and commit a runtime generation for
   * the *stable* product `sessionId` instead of letting the Product Shell
   * lazily create a second randomly identified backend session. Unlike
   * `createSession`, the caller supplies both the product session id and the
   * fresh runtime generation id so Host-owned identity stays stable.
   */
  async activateSession(
    sessionId: string,
    input: CreateSessionInput,
    runtimeGenerationId: string,
    options: CreateSessionOptions = {},
  ): Promise<SessionHandle> {
    const prepared = await this.prepareSessionWithIdentity(
      input,
      sessionId,
      runtimeGenerationId,
      'active',
      options,
    );
    return this.commitPreparedSession(prepared);
  }

  /** Promote a prepared candidate into the ProductAgentHost session map. */
  commitPreparedSession(prepared: PreparedProductSession): SessionHandle {
    this.sessions.set(prepared.sessionId, prepared.session);
    if (prepared.registrationMode === 'active') {
      this.options.onGenerationCreated?.(
        prepared.sessionId,
        prepared.runtimeGenerationId,
        prepared.settingsRevision,
        prepared.extensionSetRevision,
      );
    }
    return prepared.session;
  }

  /** Restore the stable session handle after a failed replacement publication. */
  restoreSession(sessionId: string, session: SessionHandle): void {
    this.sessions.set(sessionId, session);
  }

  /**
   * Forget exactly the stuck handle held by HostRuntime without waiting for
   * its abort promise. Generation cleanup remains exact and asynchronous.
   */
  detachSessionHandle(sessionId: string, expected: SessionHandle): boolean {
    if (this.sessions.get(sessionId) !== expected) {
      return false;
    }
    this.sessions.delete(sessionId);
    return true;
  }

  /** Abort a prepared candidate and release only its backend generation. */
  async abortPreparedSession(prepared: PreparedProductSession): Promise<void> {
    let abortError: unknown;
    try {
      await prepared.session.abort();
    } catch (error) {
      abortError = error;
    }
    try {
      await this.backend?.dropSessionGeneration(prepared.sessionId, prepared.runtimeGenerationId);
    } catch (dropError) {
      if (abortError !== undefined) {
        throw new AggregateError(
          [abortError, dropError],
          `failed to abort prepared session ${prepared.sessionId}/${prepared.runtimeGenerationId}`,
        );
      }
      throw dropError;
    }
    if (abortError !== undefined) {
      throw abortError;
    }
  }

  /** Release a retired generation without detaching the current stable session. */
  async releaseSessionGeneration(sessionId: string, runtimeGenerationId: string): Promise<void> {
    await this.backend?.dropSessionGeneration(sessionId, runtimeGenerationId);
  }

  private async createSessionWithIdentity(
    input: CreateSessionInput,
    sessionId: string,
    runtimeGenerationId: string,
    options: CreateSessionOptions = {},
  ): Promise<SessionHandle> {
    const prepared = await this.prepareSessionWithIdentity(
      input,
      sessionId,
      runtimeGenerationId,
      'active',
      options,
    );
    return this.commitPreparedSession(prepared);
  }

  private async prepareSessionWithIdentity(
    input: CreateSessionInput,
    sessionId: string,
    runtimeGenerationId: string,
    registrationMode: ProductAgentHostToolRegistrationMode,
    options: CreateSessionOptions = {},
  ): Promise<PreparedProductSession> {
    if (this.options.mock) {
      const session = createMockSessionHandle({
        ...input,
        sessionId,
        ...(options.seedMessages ? { seedMessages: options.seedMessages } : {}),
      });
      const settingsRevision = this.options.piwinRoot
        ? createSettingsSnapshot(await loadPiwinConfig(this.options.piwinRoot)).runtimeRevision
        : 'live';
      return {
        session,
        sessionId,
        runtimeGenerationId,
        settingsRevision,
        registrationMode,
        historySeeded:
          options.compactionSeed !== undefined || (options.seedMessages?.length ?? 0) > 0,
      };
    }
    if (!this.backend) {
      throw new Error('ProductAgentHost backend is unavailable');
    }
    const hostToolExecution = this.options.hostToolExecution;
    if (!hostToolExecution) {
      throw new Error(
        'ProductAgentHost requires a parent-owned HostToolExecutionPort in non-mock mode',
      );
    }
    if (!this.options.restrictToolSurface) {
      throw new Error(
        'ProductAgentHost requires a Host tool-surface restriction callback in non-mock mode',
      );
    }

    try {
      // Build concrete tool descriptors from real executors before compiling
      // the blueprint. This ensures the model-visible manifest carries exact
      // descriptions and parameter schemas rather than name-only guesses.
      const hostToolDescriptors = await this.options.buildToolDescriptors(
        sessionId,
        runtimeGenerationId,
        input.model,
        registrationMode,
      );
      const hostToolFamilyIndex = await this.options.buildToolFamilyIndex?.(
        sessionId,
        runtimeGenerationId,
        input.model,
        registrationMode,
      );
      const mcpConfig = await this.options.getMcpConfig?.(sessionId, runtimeGenerationId);
      const mcpCapabilityBrief = await this.options.getMcpCapabilityBrief?.(
        sessionId,
        runtimeGenerationId,
      );
      const rulesRevision = this.options.getPermissionRulesRevision?.(
        sessionId,
        runtimeGenerationId,
      );

      const subscription = await this.options.getSubscriptionCompileContext?.();
      const compiled = await compileBlueprintForWorker(input, {
        ...(this.options.piwinRoot ? { piwinRoot: this.options.piwinRoot } : {}),
        sessionId,
        runtimeGenerationId,
        ...(subscription
          ? {
              usableSubscriptionProviderIds: subscription.usableSubscriptionProviderIds,
              subscriptionAccounts: subscription.subscriptionAccounts,
            }
          : {}),
        hostToolDescriptors,
        ...(hostToolFamilyIndex ? { hostToolFamilyIndex } : {}),
        ...(mcpConfig ? { mcpConfig } : {}),
        ...(mcpCapabilityBrief ? { mcpCapabilityBrief } : {}),
        ...(rulesRevision !== undefined ? { rulesRevision } : {}),
        // Inline keychain secrets are permitted only for the in-process SDK
        // backend. RPC provider envelopes are serialized over worker JSONL and
        // therefore fail closed in the compiler.
        allowInlineProviderSecrets: this.options.mode === 'sdk',
        allowWorkerProviderSecretBootstrap: this.options.mode === 'rpc',
        ...(this.options.trustResolver ? { trustResolver: this.options.trustResolver } : {}),
      });
      this.options.restrictToolSurface(
        sessionId,
        runtimeGenerationId,
        compiled.sessionBlueprint.capabilitySnapshot.tools.hostTools.map((tool) => tool.name),
        compiled.sessionBlueprint.hostToolboxTargetNames,
        compiled.sessionBlueprint.capabilitySnapshot.tools.enabledFamilies.includes('mcp'),
      );

      const backendHandle = await this.backend.createSession({
        blueprint: compiled.sessionBlueprint.backendBlueprint,
        providers: compiled.providers,
        ...(compiled.providerSecrets ? { providerSecrets: compiled.providerSecrets } : {}),
        hostToolExecution,
        ...(options.seedMessages ? { seedMessages: options.seedMessages } : {}),
        ...(options.seedMode ? { seedMode: options.seedMode } : {}),
        ...(options.compactionSeed ? { compactionSeed: options.compactionSeed } : {}),
      });
      const session = createProductSessionHandle(backendHandle, this.options.getCurrentRunId);
      return {
        session,
        sessionId,
        runtimeGenerationId,
        settingsRevision:
          compiled.settingsRevision ??
          compiled.sessionBlueprint.capabilitySnapshot.inputs.settingsRevision,
        ...(compiled.sessionBlueprint.capabilitySnapshot.inputs.extensionSetRevision !== undefined
          ? {
              extensionSetRevision:
                compiled.sessionBlueprint.capabilitySnapshot.inputs.extensionSetRevision,
            }
          : {}),
        registrationMode,
        historySeeded:
          options.compactionSeed !== undefined || (options.seedMessages?.length ?? 0) > 0,
      };
    } catch (error) {
      let cleanupError: unknown;
      try {
        await this.backend.dropSessionGeneration(sessionId, runtimeGenerationId);
      } catch (errorDuringCleanup) {
        cleanupError = errorDuringCleanup;
      }
      if (registrationMode === 'active') {
        // If active generation creation fails, unregister the generation so
        // the parent port rejects any late worker frames for this session.
        await this.options.onGenerationDetached?.(sessionId);
      }
      if (cleanupError !== undefined) {
        throw new AggregateError(
          [error, cleanupError],
          `failed to prepare session ${sessionId}/${runtimeGenerationId}`,
        );
      }
      throw error;
    }
  }

  async resumeSession(sessionId: string): Promise<SessionHandle> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }
    throw new Error(
      `Session ${sessionId} is not live in this HostRuntime generation; use session/create to rebuild it`,
    );
  }

  async listSessions(scopeOrProjectPath: string | SessionScope): Promise<SessionSummary[]> {
    const scope: SessionScope =
      typeof scopeOrProjectPath === 'string'
        ? { kind: 'project', projectPath: scopeOrProjectPath }
        : scopeOrProjectPath;
    const workingDirectory = scope.kind === 'project' ? scope.projectPath : '';
    const projectPath = scope.kind === 'project' ? scope.projectPath : '';
    return [...this.sessions.keys()].map((id) => ({
      id,
      scope,
      workingDirectory,
      projectPath,
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    }));
  }

  async dropSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    this.sessions.delete(sessionId);
    const cleanupErrors: unknown[] = [];
    try {
      await this.options.onGenerationDetached?.(sessionId);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (session) {
      try {
        await session.abort();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await this.backend?.dropSession(sessionId);
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, `failed to fully drop session ${sessionId}`);
    }
  }

  async dispose(): Promise<void> {
    for (const sessionId of this.sessions.keys()) {
      await this.options.onGenerationDetached?.(sessionId);
    }
    this.sessions.clear();
    await this.backend?.dispose();
  }
}

export function createProductSessionId(): string {
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRuntimeGenerationId(): string {
  return `generation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createProductSessionHandle(
  backendHandle: BackendSessionHandle,
  getCurrentRunId?: () => string | undefined,
): SessionHandle {
  const emptyTree: SessionTreeView = { root: null, activeLeafId: null };
  const emptyMessages: AgentMessageView[] = [];
  const compact = backendHandle.compact;
  const abortCompaction = backendHandle.abortCompaction;
  const getAutoCompactionEnabled = backendHandle.getAutoCompactionEnabled;
  const setAutoCompactionEnabled = backendHandle.setAutoCompactionEnabled;
  const armRunIntervention = backendHandle.armRunIntervention;
  const cancelRunIntervention = backendHandle.cancelRunIntervention;
  const subscribeRunInterventions = backendHandle.subscribeRunInterventions;
  return {
    id: backendHandle.id,
    async prompt(input: PromptInput) {
      const images = await loadPromptImages(input.attachments);
      const runId = getCurrentRunId?.();
      if (runId === undefined) {
        throw new Error('foreground backend prompt requires runId');
      }
      return backendHandle.prompt({
        text: input.text,
        runId,
        ...(images.length > 0
          ? {
              images: images.map((image) => ({
                dataBase64: image.data,
                mimeType: image.mimeType,
              })),
            }
          : {}),
        ...(input.streamingBehavior ? { streamingBehavior: input.streamingBehavior } : {}),
        ...(input.model ? { model: input.model } : {}),
        ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      });
    },
    steer: (message) => backendHandle.steer(message),
    followUp: (message) => backendHandle.followUp(message),
    ...(armRunIntervention
      ? { armRunIntervention: (intervention) => armRunIntervention(intervention) }
      : {}),
    ...(cancelRunIntervention
      ? {
          cancelRunIntervention: (interventionId, expectedRevision) =>
            cancelRunIntervention(interventionId, expectedRevision),
        }
      : {}),
    ...(subscribeRunInterventions
      ? { subscribeRunInterventions: (listener) => subscribeRunInterventions(listener) }
      : {}),
    abort: () => backendHandle.abort(),
    ...(compact ? { compact: (customInstructions?: string) => compact(customInstructions) } : {}),
    ...(abortCompaction ? { abortCompaction: () => abortCompaction() } : {}),
    ...(getAutoCompactionEnabled
      ? { getAutoCompactionEnabled: () => getAutoCompactionEnabled() }
      : {}),
    ...(setAutoCompactionEnabled
      ? { setAutoCompactionEnabled: (enabled: boolean) => setAutoCompactionEnabled(enabled) }
      : {}),
    getMessages: async () => emptyMessages,
    getTree: async () => emptyTree,
    subscribe: (listener: (event: AgentEvent) => void) => backendHandle.subscribe(listener),
    needsProductHistoryInjection: () => false,
  };
}
