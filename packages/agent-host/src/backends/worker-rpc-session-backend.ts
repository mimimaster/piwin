/**
 * Phase 7 WP5: WorkerRpcSessionBackend.
 *
 * Uses `RpcSdkWorkerClient` to run Pi sessions in a piwin-owned worker
 * process. The worker receives the exact `SerializableBlueprint` +
 * `SerializableProviderRuntime` envelope and creates the Pi session
 * inside its own process. Tool calls are proxied back to the parent via
 * the `HostToolExecutionRouter`.
 *
 * This backend provides real process isolation (mode='rpc-worker',
 * isolated=true).
 */

import type { AgentEvent } from '@piwin/contracts';
import type {
  PiSessionBackend,
  BackendSessionHandle,
  CreateBackendSessionInput,
  PreparedPromptInput,
} from './pi-session-backend.js';
import { RpcSdkWorkerClient, type WorkerClientOptions } from '../rpc-sdk-worker-client.js';
import type { HostToolExecutionRouter } from '../tools/host-tool-execution-router.js';
import { EventEmitter } from 'node:events';

export type WorkerRpcSessionBackendOptions = {
  /** Worker client options (script path, env, etc.). */
  worker: WorkerClientOptions;
  /** Parent-owned tool execution router for proxy tool calls. */
  toolRouter?: HostToolExecutionRouter;
};

type ActiveSession = {
  handle: BackendSessionHandle;
  listeners: EventEmitter;
};

export class WorkerRpcSessionBackend implements PiSessionBackend {
  readonly mode = 'rpc-worker' as const;
  readonly isolated = true;
  private client: RpcSdkWorkerClient | null = null;
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly options: WorkerRpcSessionBackendOptions;

  constructor(options: WorkerRpcSessionBackendOptions) {
    this.options = options;
  }

  private ensureClient(): RpcSdkWorkerClient {
    if (!this.client) {
      const clientOptions: WorkerClientOptions = {
        ...this.options.worker,
        onEvent: (sessionId, event) => {
          const session = this.sessions.get(sessionId);
          if (session) {
            session.listeners.emit('event', event);
          }
          this.options.worker.onEvent?.(sessionId, event);
        },
        ...(this.options.toolRouter ? { toolRouter: this.options.toolRouter } : {}),
      };
      this.client = new RpcSdkWorkerClient(clientOptions);
      this.client.start();
    }
    return this.client;
  }

  async createSession(input: CreateBackendSessionInput): Promise<BackendSessionHandle> {
    const client = this.ensureClient();
    const created = await client.createSession({
      productSessionId: input.productSessionId,
      blueprint: input.serializable,
      ...(input.providers.length > 0 ? { providers: input.providers } : {}),
    });

    const listeners = new EventEmitter();
    const handle: BackendSessionHandle = {
      id: created.sessionId,
      async prompt(prepared: PreparedPromptInput) {
        await client.prompt(created.sessionId, prepared.text, {
          ...(prepared.images && prepared.images.length > 0
            ? {
                images: prepared.images.map((img) => ({
                  dataBase64: img.data,
                  mimeType: img.mimeType,
                })),
              }
            : {}),
          ...(prepared.thinkingLevel ? { thinkingLevel: prepared.thinkingLevel } : {}),
          ...(prepared.model
            ? { model: { providerId: prepared.model.providerId, modelId: prepared.model.modelId } }
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
      subscribe(listener: (event: AgentEvent) => void): () => void {
        listeners.on('event', listener);
        return () => listeners.off('event', listener);
      },
    };

    this.sessions.set(created.sessionId, { handle, listeners });
    return handle;
  }

  async dropSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      session.listeners.removeAllListeners();
      try {
        await this.client?.dropSession(sessionId);
      } catch {
        // best-effort
      }
    }
  }

  async dispose(): Promise<void> {
    for (const sessionId of this.sessions.keys()) {
      await this.dropSession(sessionId);
    }
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}
