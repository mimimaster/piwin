/** Isolated worker implementation of the backend-neutral session seam. */

import { EventEmitter } from 'node:events';
import type {
  AgentEvent,
  ExtensionUiPort,
  HostToolExecutionPort,
  HostToolExecutionResult,
} from '@piwin/contracts';
import type {
  BackendSessionHandle,
  CreateBackendSessionInput,
  PiSessionBackend,
} from './pi-session-backend.js';
import { assertValidBackendSessionBlueprint } from './pi-session-backend.js';
import {
  projectBackendBlueprintForWorker,
  type SerializableBlueprint,
} from '../rpc/serializable-blueprint.js';
import { AgentWorkerSupervisor } from '../agent-worker-supervisor.js';
import type { WorkerClientOptions, RpcSdkWorkerClient } from '../rpc-sdk-worker-client.js';
import type { WorkerToolCallFrame } from '../rpc-sdk-worker-protocol.js';

export type WorkerSessionBackendOptions = {
  /** Sole owner of worker process creation and release. */
  supervisor: AgentWorkerSupervisor;
  /** Source-mode/test overrides for the supervisor-owned worker. */
  worker?: Omit<WorkerClientOptions, 'onEvent' | 'onToolCall' | 'onExtensionUiRequest'>;
  /** Standalone adapters may transfer ownership; HostRuntime keeps shared ownership. */
  disposeSupervisor?: boolean;
};

type ActiveSession = {
  handle: BackendSessionHandle;
  client: RpcSdkWorkerClient;
  workerSessionId: string;
  listeners: EventEmitter;
  blueprint: SerializableBlueprint;
  productSessionId: string;
  runtimeGenerationId: string;
  hostToolExecution: HostToolExecutionPort;
  extensionUi?: ExtensionUiPort;
};

export class WorkerSessionBackend implements PiSessionBackend {
  readonly mode = 'rpc-worker' as const;
  readonly isolated = true;
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly options: WorkerSessionBackendOptions;
  private disposing = false;

  constructor(options: WorkerSessionBackendOptions) {
    this.options = options;
  }

  async createSession(input: CreateBackendSessionInput): Promise<BackendSessionHandle> {
    assertValidBackendSessionBlueprint(input.blueprint);
    // Inject only explicitly required apiKeyEnv values into this generation's
    // worker environment. The supervisor never inherits the host environment.
    const env: Record<string, string> = { ...(this.options.worker?.env ?? {}) };
    for (const provider of input.providers) {
      if (provider.auth.kind === 'env') {
        const value = process.env[provider.auth.envName];
        if (value !== undefined) env[provider.auth.envName] = value;
      }
    }
    const client = await this.options.supervisor.acquireWorker(
      input.blueprint.sessionId,
      input.blueprint.runtimeGenerationId,
      {
        ...this.options.worker,
        ...(Object.keys(env).length > 0 ? { env } : {}),
        onToolCall: (frame, signal) => this.executeHostTool(frame, signal),
        onExtensionUiRequest: (request) => this.requestExtensionUi(request),
      },
    );
    const serializableBlueprint = projectBackendBlueprintForWorker(input.blueprint);
    let created: { sessionId: string };
    try {
      created = await client.createSession({
        productSessionId: input.blueprint.sessionId,
        blueprint: serializableBlueprint,
        providers: input.providers,
        ...(input.seedMessages ? { seedMessages: input.seedMessages } : {}),
      });
    } catch (error) {
      await this.options.supervisor
        .releaseWorker(input.blueprint.sessionId, input.blueprint.runtimeGenerationId)
        .catch(() => {});
      throw error;
    }

    const listeners = new EventEmitter();
    const handle: BackendSessionHandle = {
      // Product session ids are the stable Host identity. The worker may use
      // a different internal id; that translation stays inside this backend.
      id: input.blueprint.sessionId,
      async prompt(preparedPrompt) {
        await client.prompt(created.sessionId, preparedPrompt.text, {
          ...(preparedPrompt.runId ? { runId: preparedPrompt.runId } : {}),
          ...(preparedPrompt.images && preparedPrompt.images.length > 0
            ? {
                images: preparedPrompt.images.map((image) => ({
                  dataBase64: image.dataBase64,
                  mimeType: image.mimeType,
                })),
              }
            : {}),
          ...(preparedPrompt.streamingBehavior
            ? { streamingBehavior: preparedPrompt.streamingBehavior }
            : {}),
          ...(preparedPrompt.thinkingLevel ? { thinkingLevel: preparedPrompt.thinkingLevel } : {}),
          ...(preparedPrompt.model
            ? {
                model: {
                  providerId: preparedPrompt.model.providerId,
                  modelId: preparedPrompt.model.modelId,
                },
              }
            : {}),
        });
      },
      async steer(message) {
        await client.steer(created.sessionId, message);
      },
      async followUp(message) {
        await client.followUp(created.sessionId, message);
      },
      async abort() {
        await client.abort(created.sessionId);
      },
      async compact(customInstructions?: string) {
        return client.compact(created.sessionId, customInstructions);
      },
      abortCompaction() {
        // Abort is a best-effort control message; the caller does not await it.
        void client.abortCompaction(created.sessionId);
      },
      subscribe(listener: (event: AgentEvent) => void): () => void {
        listeners.on('event', listener);
        return () => listeners.off('event', listener);
      },
    };

    const sessionKey = sessionGenerationKey(
      input.blueprint.sessionId,
      input.blueprint.runtimeGenerationId,
    );
    this.sessions.set(sessionKey, {
      handle,
      client,
      workerSessionId: created.sessionId,
      listeners,
      blueprint: serializableBlueprint,
      productSessionId: input.blueprint.sessionId,
      runtimeGenerationId: input.blueprint.runtimeGenerationId,
      hostToolExecution: input.hostToolExecution,
      ...(input.extensionUi ? { extensionUi: input.extensionUi } : {}),
    });
    client.on('event', (sessionId: string, event: AgentEvent) => {
      if (sessionId === created.sessionId || sessionId === input.blueprint.sessionId) {
        listeners.emit('event', event);
      }
    });
    client.on('exit', (code: number | null) => {
      const session = this.sessions.get(sessionKey);
      if (!session) return;
      if (!this.disposing) {
        session.listeners.emit('event', {
          type: 'error',
          message: `worker process exited (code ${code ?? 'unknown'})`,
          retriable: false,
        } satisfies AgentEvent);
      }
      session.listeners.removeAllListeners();
      this.sessions.delete(sessionKey);
    });
    return handle;
  }

  private async executeHostTool(
    frame: WorkerToolCallFrame,
    signal: AbortSignal,
  ): Promise<HostToolExecutionResult> {
    const session = this.findActiveSession(
      frame.context.sessionId,
      frame.context.runtimeGenerationId,
    );
    if (!session) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `unknown worker session: ${frame.context.sessionId}`,
      };
    }
    const descriptor = session.blueprint.tools.hostTools.find(
      (tool) => tool.name === frame.toolName,
    );
    if (!descriptor) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: `tool is not present in the compiled blueprint: ${frame.toolName}`,
      };
    }
    const argumentsRecord = normalizeToolArguments(frame.args);
    const runId = frame.context.runId;
    if (!runId) {
      return {
        ok: false,
        code: 'tool-not-available',
        message: 'worker tool call has no active Run identity',
      };
    }
    return session.hostToolExecution.execute(
      {
        sessionId: frame.context.sessionId,
        // Preserve the identity supplied by the worker frame. The exact
        // generation lookup above is part of the stale-frame boundary; never
        // rewrite a frame's generation to the matched session as a fallback.
        runtimeGenerationId: frame.context.runtimeGenerationId,
        runId,
        toolName: descriptor.name,
        arguments: argumentsRecord,
      },
      signal,
    );
  }

  private findActiveSession(
    sessionId: string,
    runtimeGenerationId?: string,
  ): ActiveSession | undefined {
    if (runtimeGenerationId !== undefined) {
      // Tool frames carry a generation identity that must match exactly.
      // Falling back to another generation would allow a late worker frame to
      // be routed into the current session surface.
      return this.sessions.get(sessionGenerationKey(sessionId, runtimeGenerationId));
    }
    const directMatch = this.sessions.get(sessionId);
    if (directMatch) {
      return directMatch;
    }
    for (const session of this.sessions.values()) {
      if (session.productSessionId === sessionId || session.workerSessionId === sessionId) {
        return session;
      }
    }
    return undefined;
  }

  private async requestExtensionUi(request: {
    sessionId: string;
    runtimeGenerationId: string;
    kind: 'confirm' | 'select' | 'input';
    title: string;
    message?: string;
    options?: string[];
    placeholder?: string;
  }): Promise<
    | { kind: 'confirm'; confirmed: boolean }
    | { kind: 'select'; value?: string; cancelled?: boolean }
    | { kind: 'input'; value?: string; cancelled?: boolean }
  > {
    const extensionUi = this.findActiveSession(
      request.sessionId,
      request.runtimeGenerationId,
    )?.extensionUi;
    if (!extensionUi) {
      throw new Error('no extension UI port configured');
    }
    return extensionUi.request(
      {
        requestId: `worker-ui-${Date.now().toString(36)}`,
        kind: request.kind,
        title: request.title,
        ...(request.message ? { message: request.message } : {}),
        ...(request.options ? { options: request.options } : {}),
        ...(request.placeholder ? { placeholder: request.placeholder } : {}),
      },
      new AbortController().signal,
    );
  }

  async dropSession(sessionId: string): Promise<void> {
    const matching = [...this.sessions.entries()].filter(
      ([key, candidate]) =>
        key.startsWith(`${sessionId}\u0000`) || candidate.workerSessionId === sessionId,
    );
    for (const [key, session] of matching) {
      await this.dropManagedSession(key, session);
    }
  }

  async dropSessionGeneration(sessionId: string, runtimeGenerationId: string): Promise<void> {
    const key = sessionGenerationKey(sessionId, runtimeGenerationId);
    const session = this.sessions.get(key);
    if (!session) {
      return;
    }
    await this.dropManagedSession(key, session);
  }

  private async dropManagedSession(key: string, session: ActiveSession): Promise<void> {
    this.sessions.delete(key);
    session.listeners.removeAllListeners();
    await session.client.dropSession(session.workerSessionId).catch(() => {
      // The worker may already have exited; dropping remains best effort.
    });
    await this.options.supervisor.releaseWorker(
      session.productSessionId,
      session.runtimeGenerationId,
    );
  }

  async dispose(): Promise<void> {
    this.disposing = true;
    for (const sessionId of [...this.sessions.keys()]) {
      await this.dropSession(sessionId);
    }
    if (this.options.disposeSupervisor) {
      await this.options.supervisor.dispose();
    }
  }
}

function sessionGenerationKey(sessionId: string, runtimeGenerationId: string): string {
  return `${sessionId}\u0000${runtimeGenerationId}`;
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}
