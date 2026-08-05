import type {
  AgentHost,
  AgentEvent,
  CreateSessionInput,
  HostToolExecutionPort,
  HostToolDescriptor,
  PromptInput,
  SessionHandle,
  SessionScope,
  SessionSummary,
  SessionTreeView,
  AgentMessageView,
} from '@piwin/contracts';
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

type ProductAgentHostCommonOptions = {
  mode: 'sdk' | 'rpc';
  piwinRoot?: string;
  onGenerationCreated?: (sessionId: string, generationId: string, settingsRevision: string) => void;
  onGenerationDetached?: (sessionId: string) => void;
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
      /**
       * Build concrete Host tool descriptors for a session. Called before
       * blueprint compilation so the compiled manifest carries real
       * descriptions and parameter schemas instead of name-only guesses.
       */
      buildToolDescriptors: (sessionId: string) => Promise<HostToolDescriptor[]>;
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
            supervisor: options.workerSupervisor ?? this.ownedWorkerSupervisor ?? new AgentWorkerSupervisor(),
            disposeSupervisor: this.ownedWorkerSupervisor !== null,
          });
  }

  async createSession(input: CreateSessionInput): Promise<SessionHandle> {
    const sessionId = createProductSessionId();
    const runtimeGenerationId = createRuntimeGenerationId();
    return this.createSessionWithIdentity(input, sessionId, runtimeGenerationId);
  }

  /** Rebuild one stable product session on a caller-owned generation id. */
  async replaceSession(
    sessionId: string,
    input: CreateSessionInput,
    runtimeGenerationId: string,
  ): Promise<SessionHandle> {
    if (this.options.mock) {
      this.sessions.delete(sessionId);
      return this.createSessionWithIdentity(input, sessionId, runtimeGenerationId);
    }
    if (!this.backend) {
      throw new Error('ProductAgentHost backend is unavailable');
    }
    const previous = this.sessions.get(sessionId);
    if (previous) {
      await previous.abort().catch(() => undefined);
    }
    this.sessions.delete(sessionId);
    await this.backend.dropSession(sessionId);
    return this.createSessionWithIdentity(input, sessionId, runtimeGenerationId);
  }

  private async createSessionWithIdentity(
    input: CreateSessionInput,
    sessionId: string,
    runtimeGenerationId: string,
  ): Promise<SessionHandle> {
    if (this.options.mock) {
      const session = createMockSessionHandle({ ...input, sessionId });
      this.sessions.set(session.id, session);
      this.options.onGenerationCreated?.(session.id, runtimeGenerationId, 'live');
      return session;
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

    // Build concrete tool descriptors from real executors before compiling
    // the blueprint. This ensures the model-visible manifest carries exact
    // descriptions and parameter schemas rather than name-only guesses.
    const hostToolDescriptors = await this.options.buildToolDescriptors(sessionId);

    const compiled = await compileBlueprintForWorker(input, {
      ...(this.options.piwinRoot ? { piwinRoot: this.options.piwinRoot } : {}),
      sessionId,
      runtimeGenerationId,
      hostToolDescriptors,
      // Inline keychain secrets are permitted only for the in-process SDK
      // backend. RPC provider envelopes are serialized over worker JSONL and
      // therefore fail closed in the compiler.
      allowInlineProviderSecrets: this.options.mode === 'sdk',
      ...(this.options.trustResolver ? { trustResolver: this.options.trustResolver } : {}),
    });

    try {
      const backendHandle = await this.backend.createSession({
        blueprint: compiled.sessionBlueprint.backendBlueprint,
        providers: compiled.providers,
        hostToolExecution,
      });
      const session = createProductSessionHandle(backendHandle, this.options.getCurrentRunId);
      this.sessions.set(session.id, session);
      // Publish only after backend construction succeeds. HostRuntime binds
      // the session subscription immediately after this returns, so failed
      // creation can never leave a false active generation behind.
      this.options.onGenerationCreated?.(
        sessionId,
        runtimeGenerationId,
        compiled.settingsRevision ?? compiled.sessionBlueprint.capabilitySnapshot.inputs.settingsRevision,
      );
      return session;
    } catch (error) {
      // If backend creation fails, unregister the generation so the parent
      // port rejects any late worker frames for this session.
      this.options.onGenerationDetached?.(sessionId);
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
    this.options.onGenerationDetached?.(sessionId);
    if (session) {
      await session.abort().catch(() => undefined);
    }
    await this.backend?.dropSession(sessionId);
  }

  async dispose(): Promise<void> {
    for (const sessionId of this.sessions.keys()) {
      this.options.onGenerationDetached?.(sessionId);
    }
    this.sessions.clear();
    await this.backend?.dispose();
  }
}

function createProductSessionId(): string {
  return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createRuntimeGenerationId(): string {
  return `generation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createProductSessionHandle(
  backendHandle: BackendSessionHandle,
  getCurrentRunId?: () => string | undefined,
): SessionHandle {
  const emptyTree: SessionTreeView = { root: null, activeLeafId: null };
  const emptyMessages: AgentMessageView[] = [];
  return {
    id: backendHandle.id,
    async prompt(input: PromptInput) {
      const images = await loadPromptImages(input.attachments);
      const runId = getCurrentRunId?.();
      await backendHandle.prompt({
        text: input.text,
        ...(runId ? { runId } : {}),
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
    abort: () => backendHandle.abort(),
    getMessages: async () => emptyMessages,
    getTree: async () => emptyTree,
    subscribe: (listener: (event: AgentEvent) => void) => backendHandle.subscribe(listener),
    needsProductHistoryInjection: () => false,
  };
}
