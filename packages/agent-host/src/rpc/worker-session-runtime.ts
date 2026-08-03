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
} from '../rpc-sdk-worker-protocol.js';

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
};

export type WorkerSessionRuntimeOptions = {
  /** Frame sink to stdout (responses, events, tool-call proxies). */
  sendFrame: (frame: WorkerResponse | WorkerEvent | WorkerToolCallFrame) => void;
  /** Creates a Pi session inside this process from the exact blueprint. */
  createPiSession: (input: CreateWorkerPiSessionInput) => Promise<WorkerPiSessionLike>;
  /** Optional custom event mapper (defaults to the product Pi mapper). */
  eventMapper?: PiSessionEventMapper;
};

type RuntimeSession = {
  handle: WorkerPiSessionLike;
  unsubscribe: () => void;
};

export class WorkerSessionRuntime {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly options: WorkerSessionRuntimeOptions;
  private readonly eventMapper: PiSessionEventMapper;

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
    const handle = await this.options.createPiSession({
      productSessionId: payload.productSessionId,
      blueprint: payload.blueprint,
      ...(payload.providers ? { providers: payload.providers } : {}),
    });
    this.attachSession(payload.productSessionId, handle);
    this.sendResponse(id, true, { sessionId: handle.id });
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
    this.sendResponse(id, true, {});
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
