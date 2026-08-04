/**
 * Worker-side session runtime (Phase 7 plan §7, WP3).
 *
 * Owns the request dispatch for a single worker process. It does NOT load
 * Settings or resolve capabilities; it receives an exact SerializableBlueprint
 * per session and a `createPiSession` factory. Pi-native events are mapped to
 * normalized AgentEvent before emission.
 */

import type { AgentEvent } from '@piwin/contracts';
import { createPiSessionEventMapper, type PiSessionEventMapper } from '../event-map.js';
import type {
  SerializableBlueprint,
  SerializableProviderRuntime,
} from './serializable-blueprint.js';
import type {
  WorkerEvent,
  WorkerRequest,
  WorkerRequestPayload,
  WorkerResponse,
  WorkerToolCallFrame,
  WorkerToolResultFrame,
} from '../rpc-sdk-worker-protocol.js';
import { buildWorkerProxyTools, type ToolProxyCall } from './worker-proxy-tool-factory.js';

/** Minimal Pi-like session surface the worker runtime needs. */
export type WorkerPiSessionLike = {
  id: string;
  prompt: (
    text: string,
    options?: { images?: Array<{ data: string; mimeType: string }> },
  ) => Promise<void>;
  steer?: (message: string) => Promise<void>;
  followUp?: (message: string) => Promise<void>;
  abort?: () => Promise<void>;
  subscribe: (listener: (raw: unknown) => void) => () => void;
};

export type CreateWorkerPiSessionInput = {
  productSessionId: string;
  blueprint: SerializableBlueprint;
  providers?: SerializableProviderRuntime[];
  /**
   * Proxy tool definitions to register with the Pi session (WP4).
   * The factory injects these as `customTools` so the model can call them;
   * their executors call back to the parent via the tool proxy.
   */
  proxyTools?: import('../pi-tool-adapter.js').PiCustomToolDefinition[];
};

export type WorkerSessionRuntimeOptions = {
  /** Frame sink to stdout (responses, events, tool-call proxies). */
  sendFrame: (frame: WorkerResponse | WorkerEvent | WorkerToolCallFrame) => void;
  /** Creates a Pi session inside this process from the exact blueprint. */
  createPiSession: (input: CreateWorkerPiSessionInput) => Promise<WorkerPiSessionLike>;
  /** Optional custom event mapper (defaults to the product Pi mapper). */
  eventMapper?: PiSessionEventMapper;
  /**
   * When true, the runtime builds proxy tools for the blueprint's
   * customToolNames and injects them into the Pi session (WP4). The proxy
   * executor sends a `tool-call` frame via `sendFrame` and awaits the
   * matching `tool-result` via `handleToolResult`.
   */
  enableToolProxy?: boolean;
};

type RuntimeSession = {
  handle: WorkerPiSessionLike;
  unsubscribe: () => void;
};

type PendingToolCall = {
  resolve: (
    result: { ok: true; output: string } | { ok: false; code: string; message: string },
  ) => void;
  reject: (error: Error) => void;
};

export class WorkerSessionRuntime {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly options: WorkerSessionRuntimeOptions;
  private readonly eventMapper: PiSessionEventMapper;
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();

  constructor(options: WorkerSessionRuntimeOptions) {
    this.options = options;
    this.eventMapper = options.eventMapper ?? createPiSessionEventMapper();
  }

  async handleRequest(request: WorkerRequest): Promise<void> {
    const { id, payload } = request;
    try {
      // Switch on payload.method (the discriminant of WorkerRequestPayload) so
      // TypeScript narrows `payload` in each branch. `request.method` is the
      // same value but lives on a separate field and cannot correlate.
      switch (payload.method) {
        case 'session/create': {
          if ('blueprint' in payload) {
            await this.handleCreateBlueprint(id, payload);
          } else {
            await this.handleCreateLegacy(id, payload);
          }
          break;
        }
        case 'session/prompt':
          await this.handlePrompt(id, payload);
          break;
        case 'session/abort':
          await this.handleAbort(id, payload);
          break;
        case 'session/steer':
          await this.handleSteer(id, payload);
          break;
        case 'session/follow-up':
          await this.handleFollowUp(id, payload);
          break;
        case 'session/drop':
          await this.handleDrop(id, payload);
          break;
        default: {
          // Unreachable: all WorkerRequestPayload method variants are handled.
          // Kept for forward-compat if new methods are added without a handler.
          const method = (payload as { method: string }).method;
          this.sendResponse(id, false, undefined, `unknown method: ${method}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendResponse(id, false, undefined, message);
    }
  }

  private async handleCreateBlueprint(
    id: string,
    payload: Extract<
      WorkerRequestPayload,
      { method: 'session/create'; blueprint: SerializableBlueprint }
    >,
  ): Promise<void> {
    // Build proxy tools for the blueprint's custom tool names (WP4).
    // The proxy executor sends a tool-call frame and awaits a tool-result.
    const proxyTools = this.buildProxyTools(payload.blueprint, payload.productSessionId);
    const handle = await this.options.createPiSession({
      productSessionId: payload.productSessionId,
      blueprint: payload.blueprint,
      ...(payload.providers ? { providers: payload.providers } : {}),
      ...(proxyTools.length > 0 ? { proxyTools } : {}),
    });
    this.attachSession(payload.productSessionId, handle);
    this.sendResponse(id, true, { sessionId: handle.id });
  }

  /**
   * Build proxy tools that call back to the parent via the tool proxy.
   * Each tool call is correlated by a unique id prefixed with the session id
   * so `handleDrop` can cancel outstanding calls for a dropped session.
   */
  private buildProxyTools(
    blueprint: SerializableBlueprint,
    sessionId: string,
  ): import('../pi-tool-adapter.js').PiCustomToolDefinition[] {
    if (!this.options.enableToolProxy || blueprint.tools.customToolNames.length === 0) {
      return [];
    }
    return buildWorkerProxyTools(blueprint, (sid, toolName, args, signal) => {
      const toolCallId = `${sid}|${toolName}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const frame: WorkerToolCallFrame = {
        type: 'tool-call',
        id: toolCallId,
        sessionId: sid,
        toolName,
        args,
      };
      this.options.sendFrame(frame);
      return new Promise((resolve, reject) => {
        this.pendingToolCalls.set(toolCallId, { resolve, reject });
        if (signal) {
          signal.addEventListener('abort', () => {
            const pending = this.pendingToolCalls.get(toolCallId);
            if (pending) {
              this.pendingToolCalls.delete(toolCallId);
              resolve({ ok: false, code: 'aborted', message: 'tool proxy aborted' });
            }
          });
        }
      });
    });
  }

  private async handleCreateLegacy(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/create'; projectPath: string }>,
  ): Promise<void> {
    const { projectPath, workingDirectory } = payload;
    const sessionId = `worker-${projectPath.replace(/[^a-z0-9]+/gi, '-')}-${id.slice(0, 6)}`;
    // Legacy subagent-task path: the task runner drives a text-only session.
    // Real legacy task sessions require a blueprint; WP5 migrates the runner.
    this.sendResponse(id, true, { sessionId, projectPath, workingDirectory });
  }

  private async handlePrompt(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/prompt' }>,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    const options =
      payload.images && payload.images.length > 0
        ? {
            images: payload.images.map((image) => ({
              data: image.dataBase64,
              mimeType: image.mimeType,
            })),
          }
        : undefined;
    await session.handle.prompt(payload.text, options);
    this.sendResponse(id, true, {});
  }

  private async handleAbort(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/abort' }>,
  ): Promise<void> {
    const session = this.sessions.get(payload.sessionId);
    if (session?.handle.abort) {
      await session.handle.abort();
    }
    this.sendResponse(id, true, {});
  }

  private async handleSteer(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/steer' }>,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    if (!session.handle.steer) {
      throw new Error('session does not support steer');
    }
    await session.handle.steer(payload.message);
    this.sendResponse(id, true, {});
  }

  private async handleFollowUp(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/follow-up' }>,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    if (!session.handle.followUp) {
      throw new Error('session does not support follow-up');
    }
    await session.handle.followUp(payload.message);
    this.sendResponse(id, true, {});
  }

  private async handleDrop(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/drop' }>,
  ): Promise<void> {
    const session = this.sessions.get(payload.sessionId);
    if (session) {
      session.unsubscribe();
      this.sessions.delete(payload.sessionId);
    }
    // Reject any pending tool calls for this session so proxy executors don't hang.
    for (const [toolCallId, pending] of this.pendingToolCalls) {
      if (toolCallId.startsWith(`${payload.sessionId}|`)) {
        this.pendingToolCalls.delete(toolCallId);
        pending.reject(new Error(`session dropped: ${payload.sessionId}`));
      }
    }
    this.sendResponse(id, true, {});
  }

  /**
   * Handle a `tool-result` frame from the parent (WP4). Resolves the
   * pending tool-call promise by correlation id.
   */
  handleToolResult(frame: WorkerToolResultFrame): void {
    const pending = this.pendingToolCalls.get(frame.id);
    if (!pending) {
      return;
    }
    this.pendingToolCalls.delete(frame.id);
    if (frame.ok) {
      const output =
        typeof frame.result === 'string' ? frame.result : JSON.stringify(frame.result ?? '');
      pending.resolve({ ok: true, output });
    } else {
      pending.resolve({
        ok: false,
        code: frame.code ?? 'tool-not-available',
        message: frame.error ?? 'tool proxy failed',
      });
    }
  }

  private attachSession(sessionId: string, handle: WorkerPiSessionLike): void {
    const unsubscribe = handle.subscribe((raw) => {
      for (const wrapped of this.eventMapper.map(raw)) {
        const frame: WorkerEvent = {
          type: 'event',
          sessionId: handle.id,
          event: wrapped.event,
        };
        this.options.sendFrame(frame);
      }
    });
    this.sessions.set(sessionId, { handle, unsubscribe });
  }

  private requireSession(sessionId: string): RuntimeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`unknown session: ${sessionId}`);
    }
    return session;
  }

  private sendResponse(id: string, success: boolean, data: unknown, error?: string): void {
    if (success) {
      this.options.sendFrame({ type: 'response', id, success: true, data });
    } else {
      this.options.sendFrame({
        type: 'response',
        id,
        success: false,
        error: error ?? 'unknown error',
      });
    }
  }
}

/** Map a single raw Pi event to a normalized AgentEvent (test helper). */
export function mapSinglePiEvent(mapper: PiSessionEventMapper, raw: unknown): AgentEvent[] {
  return mapper.map(raw).map((wrapped) => wrapped.event);
}
