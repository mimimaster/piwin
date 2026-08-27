/**
 * Worker-side session runtime (Phase 7 plan §7, WP3).
 *
 * Owns the request dispatch for a single worker process. It does NOT load
 * Settings or resolve capabilities; it receives an exact SerializableBlueprint
 * per session and a `createPiSession` factory. Pi-native events are mapped to
 * normalized AgentEvent before emission.
 */

import { failedAgentPromptOutcome } from '@piwin/contracts';
import type {
  AgentEvent,
  BackendRunIntervention,
  BackendRunInterventionEvent,
  BackendRunInterventionEventResult,
  ExtensionUiPort,
  SessionCompactResult,
  SessionSeedMessage,
  ToolResult,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { createPiSessionEventMapper, type PiSessionEventMapper } from '../event-map.js';
import type {
  SerializableBlueprint,
  SerializableProviderRuntime,
  SerializableWorkerProviderRuntime,
} from './serializable-blueprint.js';
import type {
  WorkerEvent,
  WorkerFrameContext,
  WorkerRequest,
  WorkerRequestPayload,
  WorkerResponse,
  WorkerToolCallFrame,
  WorkerToolResultFrame,
  WorkerExtensionUiRequestFrame,
  WorkerExtensionUiResponseFrame,
  WorkerInterventionPermitFrame,
  WorkerInterventionClaimFrame,
  WorkerInterventionEventFrame,
} from '../rpc-sdk-worker-protocol.js';
import { buildWorkerProxyTools } from './worker-proxy-tool-factory.js';
import {
  assertWorkerSafeProviderRuntimes,
  isSerializableBlueprint,
} from './serializable-blueprint.js';
import type { PiBackendCustomToolDefinition } from '../backends/pi-backend-tool-adapter.js';
import { normalizeAgentEventIds, normalizeGenerationToolCallId } from '../generation-identity.js';
import { stampPublishedAgentEvent } from '../agent-event-run-id.js';
import { runTrackedPiPrompt } from '../pi-prompt-outcome-tracker.js';

/** Minimal Pi-like session surface the worker runtime needs. */
export type WorkerPiSessionLike = {
  id: string;
  prompt: (
    text: string,
    options?: {
      images?: Array<{ data: string; mimeType: string }>;
      streamingBehavior?: 'steer' | 'followUp';
      thinkingLevel?: string;
      model?: { providerId: string; modelId: string };
    },
  ) => Promise<void>;
  steer?: (message: string) => Promise<void>;
  followUp?: (message: string) => Promise<void>;
  abort?: () => Promise<void>;
  compact?: (customInstructions?: string) => Promise<SessionCompactResult>;
  abortCompaction?: () => void;
  subscribe: (listener: (raw: unknown) => void) => () => void;
  setActiveRunId?(runId: string | undefined): void;
  armRunIntervention?(intervention: BackendRunIntervention): Promise<void>;
  cancelRunIntervention?(interventionId: string, expectedRevision: number): Promise<boolean>;
  subscribeRunInterventions?(
    listener: (event: BackendRunInterventionEvent) => Promise<BackendRunInterventionEventResult>,
  ): () => void;
  settleRunInterventions?(runId: string): Promise<void>;
};

export type CreateWorkerPiSessionInput = {
  productSessionId: string;
  runtimeGenerationId: string;
  blueprint: SerializableBlueprint;
  providers?: SerializableWorkerProviderRuntime[];
  seedMessages?: readonly SessionSeedMessage[];
  /** `compaction` (default) forces whole-history compaction; `replay` keeps seeds intact. */
  seedMode?: 'compaction' | 'replay';
  extensionUi?: ExtensionUiPort;
  /**
   * Proxy tool definitions to register with the Pi session (WP4).
   * The factory injects these as `customTools` so the model can call them;
   * their executors call back to the parent via the tool proxy.
   */
  proxyTools?: PiBackendCustomToolDefinition[];
};

export type WorkerSessionRuntimeOptions = {
  /** Frame sink to stdout (responses, events, tool-call proxies). */
  sendFrame: (
    frame:
      | WorkerResponse
      | WorkerEvent
      | WorkerToolCallFrame
      | WorkerExtensionUiRequestFrame
      | WorkerInterventionClaimFrame
      | WorkerInterventionEventFrame,
  ) => void;
  /** Creates a Pi session inside this process from the exact blueprint. */
  createPiSession: (input: CreateWorkerPiSessionInput) => Promise<WorkerPiSessionLike>;
  /** Optional custom event mapper (defaults to the product Pi mapper). */
  eventMapper?: PiSessionEventMapper;
  /**
   * When true, the runtime builds proxy tools for the blueprint's
   * hostTools and injects them into the Pi session (WP4). The proxy
   * executor sends a `tool-call` frame via `sendFrame` and awaits the
   * matching `tool-result` via `handleToolResult`.
   */
  enableToolProxy?: boolean;
};

type RuntimeSession = {
  handle: WorkerPiSessionLike;
  productSessionId: string;
  workerSessionId: string;
  unsubscribe: () => void;
  context: Pick<WorkerFrameContext, 'sessionId' | 'runtimeGenerationId'>;
  activeRunId: string | undefined;
  trailingRunId: string | undefined;
  unsubscribeInterventions?: () => void;
};

type PendingToolCall = {
  sessionId: string;
  context: WorkerFrameContext;
  controller: AbortController;
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
};

type PendingExtensionUiRequest = {
  sessionId: string;
  context: WorkerFrameContext;
  resolve: (response: NonNullable<WorkerExtensionUiResponseFrame['result']>) => void;
  reject: (error: Error) => void;
};

export class WorkerSessionRuntime {
  private readonly sessions = new Map<string, RuntimeSession>();
  private readonly options: WorkerSessionRuntimeOptions;
  private readonly eventMapper: PiSessionEventMapper;
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();
  private readonly sessionToolCallControllers = new Map<string, Set<AbortController>>();
  private readonly pendingExtensionUiRequests = new Map<string, PendingExtensionUiRequest>();
  private readonly requestContexts = new Map<string, WorkerFrameContext>();
  private readonly pendingInterventionClaims = new Map<
    string,
    {
      resolve: (accepted: boolean) => void;
      context: WorkerFrameContext;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(options: WorkerSessionRuntimeOptions) {
    this.options = options;
    this.eventMapper = options.eventMapper ?? createPiSessionEventMapper();
  }

  async handleRequest(request: WorkerRequest): Promise<void> {
    const { id, payload } = request;
    this.requestContexts.set(id, request.context);
    try {
      // Switch on payload.method (the discriminant of WorkerRequestPayload) so
      // TypeScript narrows `payload` in each branch. `request.method` is the
      // same value but lives on a separate field and cannot correlate.
      switch (payload.method) {
        case 'session/create': {
          await this.handleCreateBlueprint(id, payload, request.context);
          break;
        }
        case 'session/prompt':
          await this.handlePrompt(id, payload, request.context);
          break;
        case 'session/abort':
          await this.handleAbort(id, payload, request.context);
          break;
        case 'session/steer':
          await this.handleSteer(id, payload, request.context);
          break;
        case 'session/follow-up':
          await this.handleFollowUp(id, payload, request.context);
          break;
        case 'session/intervention-arm':
          await this.handleInterventionArm(id, payload, request.context);
          break;
        case 'session/intervention-cancel':
          await this.handleInterventionCancel(id, payload, request.context);
          break;
        case 'session/compact':
          await this.handleCompact(id, payload, request.context);
          break;
        case 'session/compact-abort':
          await this.handleCompactAbort(id, payload, request.context);
          break;
        case 'session/drop':
          await this.handleDrop(id, payload, request.context);
          break;
        default: {
          // Unreachable: all WorkerRequestPayload method variants are handled.
          // Kept for forward-compat if new methods are added without a handler.
          const method = (payload as { method: string }).method;
          this.sendResponse(id, false, undefined, `unknown method: ${method}`);
        }
      }
    } catch (error) {
      const message = formatError(error);
      this.sendResponse(id, false, undefined, message);
    }
  }

  handleInterventionPermit(frame: WorkerInterventionPermitFrame): void {
    const pending = this.pendingInterventionClaims.get(frame.id);
    if (
      pending === undefined ||
      pending.context.sessionId !== frame.context.sessionId ||
      pending.context.runtimeGenerationId !== frame.context.runtimeGenerationId
    ) {
      return;
    }
    this.pendingInterventionClaims.delete(frame.id);
    clearTimeout(pending.timeout);
    pending.resolve(frame.accepted);
  }

  private async handleCreateBlueprint(
    id: string,
    payload: Extract<
      WorkerRequestPayload,
      { method: 'session/create'; blueprint: SerializableBlueprint }
    >,
    context: WorkerFrameContext,
  ): Promise<void> {
    if (!isSerializableBlueprint(payload.blueprint)) {
      throw new Error('malformed SerializableBlueprint');
    }
    if (payload.productSessionId !== context.sessionId) {
      throw new Error('session/create frame context does not match blueprint identity');
    }
    if (payload.providers) {
      // JSON input is untrusted even though the TypeScript protocol excludes
      // inline auth. Reject a forged/legacy frame before session creation.
      assertWorkerSafeProviderRuntimes(
        payload.providers as unknown as SerializableProviderRuntime[],
      );
    }
    // Build proxy tools for the blueprint's Host tool descriptors (WP4).
    // The proxy executor sends a tool-call frame and awaits a tool-result.
    const proxyTools = this.buildProxyTools(payload.blueprint, payload.productSessionId);
    const handle = await this.options.createPiSession({
      productSessionId: payload.productSessionId,
      runtimeGenerationId: context.runtimeGenerationId,
      blueprint: payload.blueprint,
      ...(payload.providers ? { providers: payload.providers } : {}),
      ...(payload.seedMessages ? { seedMessages: payload.seedMessages } : {}),
      ...(payload.seedMode ? { seedMode: payload.seedMode } : {}),
      extensionUi: this.createExtensionUiPort(payload.productSessionId),
      ...(proxyTools.length > 0 ? { proxyTools } : {}),
    });
    this.attachSession(payload.productSessionId, handle, context);
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
  ): PiBackendCustomToolDefinition[] {
    if (!this.options.enableToolProxy || blueprint.tools.hostTools.length === 0) {
      return [];
    }
    return buildWorkerProxyTools(
      blueprint,
      (sid, backendToolCallId, toolName, args, signal) => {
        const runtimeSession = this.requireSession(sid);
        const toolCallId = normalizeGenerationToolCallId(
          {
            sessionId: sid,
            runtimeGenerationId: runtimeSession.context.runtimeGenerationId,
          },
          backendToolCallId,
        );
        const context: WorkerFrameContext = { ...runtimeSession.context, toolCallId };
        if (runtimeSession.activeRunId !== undefined) {
          context.runId = runtimeSession.activeRunId;
        }
        const controller = new AbortController();
        const sessionControllers = this.sessionToolCallControllers.get(sid) ?? new Set();
        sessionControllers.add(controller);
        this.sessionToolCallControllers.set(sid, sessionControllers);
        const frame: WorkerToolCallFrame = {
          type: 'tool-call',
          id: toolCallId,
          context,
          toolName,
          args,
        };
        this.options.sendFrame(frame);
        return new Promise((resolve, reject) => {
          this.pendingToolCalls.set(toolCallId, {
            sessionId: sid,
            context,
            controller,
            resolve,
            reject,
          });
          const removeController = (): void => {
            const activeControllers = this.sessionToolCallControllers.get(sid);
            activeControllers?.delete(controller);
            if (activeControllers && activeControllers.size === 0) {
              this.sessionToolCallControllers.delete(sid);
            }
          };
          controller.signal.addEventListener('abort', () => {
            const pending = this.pendingToolCalls.get(toolCallId);
            if (pending) {
              this.pendingToolCalls.delete(toolCallId);
              removeController();
              resolve({ ok: false, code: 'aborted', message: 'tool proxy aborted' });
            }
          });
          if (signal) {
            if (signal.aborted) {
              controller.abort();
            } else {
              signal.addEventListener('abort', () => controller.abort(), { once: true });
            }
          }
        });
      },
      sessionId,
    );
  }

  private async handlePrompt(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/prompt' }>,
    context: WorkerFrameContext,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    this.assertSessionContext(session, context);
    if (context.runId === undefined) {
      this.sendResponse(
        id,
        true,
        failedAgentPromptOutcome({
          code: 'backend-protocol-error',
          origin: 'protocol',
          message: 'foreground worker prompt requires runId',
          retriable: false,
        }),
      );
      return;
    }
    session.trailingRunId = context.runId;
    session.activeRunId = context.runId;
    session.handle.setActiveRunId?.(context.runId);
    const options =
      payload.images && payload.images.length > 0
        ? {
            images: payload.images.map((image) => ({
              data: image.dataBase64,
              mimeType: image.mimeType,
            })),
          }
        : undefined;
    const promptOptions = {
      ...(options ?? {}),
      ...(payload.streamingBehavior ? { streamingBehavior: payload.streamingBehavior } : {}),
      ...(payload.thinkingLevel ? { thinkingLevel: payload.thinkingLevel } : {}),
      ...(payload.model ? { model: payload.model } : {}),
    };
    try {
      const outcome = await runTrackedPiPrompt({
        subscribe: (listener) => session.handle.subscribe(listener),
        prompt: () =>
          session.handle.prompt(
            payload.text,
            Object.keys(promptOptions).length > 0 ? promptOptions : undefined,
          ),
      });
      this.sendResponse(id, true, outcome);
    } finally {
      await session.handle.settleRunInterventions?.(context.runId);
      session.handle.setActiveRunId?.(undefined);
      session.activeRunId = undefined;
    }
  }

  private async handleAbort(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/abort' }>,
    context: WorkerFrameContext,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    this.assertSessionContext(session, context);
    this.abortPendingToolCalls(session.productSessionId);
    try {
      if (session?.handle.abort) {
        await session.handle.abort();
      }
    } finally {
      this.eventMapper.reset?.();
    }
    this.sendResponse(id, true, {});
  }

  private async handleSteer(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/steer' }>,
    context: WorkerFrameContext,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    this.assertSessionContext(session, context);
    if (!session.handle.steer) {
      throw new Error('session does not support steer');
    }
    await session.handle.steer(payload.message);
    this.sendResponse(id, true, {});
  }

  private async handleFollowUp(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/follow-up' }>,
    context: WorkerFrameContext,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    this.assertSessionContext(session, context);
    if (!session.handle.followUp) {
      throw new Error('session does not support follow-up');
    }
    await session.handle.followUp(payload.message);
    this.sendResponse(id, true, {});
  }

  private async handleInterventionArm(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/intervention-arm' }>,
    context: WorkerFrameContext,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    this.assertSessionContext(session, context);
    if (!session.handle.armRunIntervention) {
      throw new Error('session does not support run interventions');
    }
    await session.handle.armRunIntervention(payload.intervention);
    this.sendResponse(id, true, {});
  }

  private async handleInterventionCancel(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/intervention-cancel' }>,
    context: WorkerFrameContext,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    this.assertSessionContext(session, context);
    const cancelled = await session.handle.cancelRunIntervention?.(
      payload.interventionId,
      payload.expectedRevision,
    );
    this.sendResponse(id, true, { cancelled: cancelled === true });
  }

  private async handleCompact(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/compact' }>,
    context: WorkerFrameContext,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    this.assertSessionContext(session, context);
    if (!session.handle.compact) {
      throw new Error('session does not support compaction');
    }
    const result = payload.customInstructions
      ? await session.handle.compact(payload.customInstructions)
      : await session.handle.compact();
    this.sendResponse(id, true, result);
  }

  private async handleCompactAbort(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/compact-abort' }>,
    context: WorkerFrameContext,
  ): Promise<void> {
    const session = this.requireSession(payload.sessionId);
    this.assertSessionContext(session, context);
    session.handle.abortCompaction?.();
    this.sendResponse(id, true, {});
  }

  private async handleDrop(
    id: string,
    payload: Extract<WorkerRequestPayload, { method: 'session/drop' }>,
    context: WorkerFrameContext,
  ): Promise<void> {
    const session = this.sessions.get(payload.sessionId);
    if (session) {
      this.assertSessionContext(session, context);
      session.unsubscribe();
      session.unsubscribeInterventions?.();
      this.deleteSessionAliases(session);
    }
    if (session) {
      this.rejectPendingCallsForDroppedSession(session);
      this.eventMapper.reset?.();
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
    if (!sameFrameContext(pending.context, frame.context)) {
      pending.reject(new Error('stale tool-result frame context'));
      this.pendingToolCalls.delete(frame.id);
      this.removeSessionToolCallController(pending);
      return;
    }
    this.pendingToolCalls.delete(frame.id);
    this.removeSessionToolCallController(pending);
    if (frame.result) {
      pending.resolve(frame.result);
      return;
    }
    // Parse-compatible fallback for older workers that split error fields
    // instead of carrying the complete ToolResult object.
    if (frame.ok) {
      pending.resolve({ ok: true, output: '' });
      return;
    }
    pending.resolve({
      ok: false,
      code: frame.code ?? 'tool-not-available',
      message: frame.error ?? 'tool proxy failed',
    });
  }

  handleExtensionUiResponse(frame: WorkerExtensionUiResponseFrame): void {
    const pendingRequest = this.pendingExtensionUiRequests.get(frame.id);
    if (!pendingRequest) {
      return;
    }
    this.pendingExtensionUiRequests.delete(frame.id);
    if (frame.ok && frame.result) {
      pendingRequest.resolve(frame.result);
      return;
    }
    pendingRequest.reject(new Error(frame.error ?? 'extension UI request failed'));
  }

  private createExtensionUiPort(sessionId: string): ExtensionUiPort {
    return {
      request: (input, signal) => {
        const requestId = `${sessionId}|ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const extensionContext: WorkerFrameContext = {
          ...this.requireSession(sessionId).context,
        };
        const activeRunId = this.requireSession(sessionId).activeRunId;
        if (activeRunId !== undefined) extensionContext.runId = activeRunId;
        const frame: WorkerExtensionUiRequestFrame = {
          type: 'extension-ui-request',
          id: requestId,
          context: extensionContext,
          kind: input.kind,
          title: input.title,
          ...(input.message ? { message: input.message } : {}),
          ...(input.options ? { options: input.options } : {}),
          ...(input.placeholder ? { placeholder: input.placeholder } : {}),
        };
        return new Promise((resolve, reject) => {
          this.pendingExtensionUiRequests.set(requestId, {
            sessionId,
            context: frame.context,
            resolve,
            reject,
          });
          if (signal.aborted) {
            this.pendingExtensionUiRequests.delete(requestId);
            reject(new Error('extension UI request aborted'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              const pendingRequest = this.pendingExtensionUiRequests.get(requestId);
              if (pendingRequest) {
                this.pendingExtensionUiRequests.delete(requestId);
                pendingRequest.reject(new Error('extension UI request aborted'));
              }
            },
            { once: true },
          );
          try {
            this.options.sendFrame(frame);
          } catch (error) {
            this.pendingExtensionUiRequests.delete(requestId);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      },
    };
  }

  private attachSession(
    sessionId: string,
    handle: WorkerPiSessionLike,
    context: WorkerFrameContext,
  ): void {
    const unsubscribe = handle.subscribe((raw) => {
      for (const wrapped of this.eventMapper.map(raw)) {
        const eventContext: WorkerFrameContext = {
          sessionId,
          runtimeGenerationId: context.runtimeGenerationId,
        };
        const runtimeSession = this.sessions.get(sessionId);
        const publishRunId = runtimeSession?.activeRunId ?? runtimeSession?.trailingRunId;
        if (publishRunId !== undefined) eventContext.runId = publishRunId;
        const event = stampPublishedAgentEvent(
          normalizeAgentEventIds(wrapped.event, {
            sessionId,
            runtimeGenerationId: context.runtimeGenerationId,
          }),
          publishRunId,
        );
        if (!event) {
          continue;
        }
        const frame: WorkerEvent = {
          type: 'event',
          // Product IDs are the parent correlation key. The worker ID remains
          // available as an alias for requests and in the create response.
          context: eventContext,
          event,
        };
        this.options.sendFrame(frame);
      }
    });
    const session: RuntimeSession = {
      handle,
      productSessionId: sessionId,
      workerSessionId: handle.id,
      unsubscribe,
      context: {
        sessionId,
        runtimeGenerationId: context.runtimeGenerationId,
      },
      activeRunId: undefined,
      trailingRunId: undefined,
    };
    this.sessions.set(sessionId, session);
    if (handle.id !== sessionId) {
      this.sessions.set(handle.id, session);
    }
    if (handle.subscribeRunInterventions) {
      session.unsubscribeInterventions = handle.subscribeRunInterventions(async (event) => {
        const eventContext: WorkerFrameContext = {
          sessionId,
          runtimeGenerationId: context.runtimeGenerationId,
          runId: event.runId,
        };
        if (event.type !== 'claim') {
          this.options.sendFrame({
            type: 'intervention-event',
            context: eventContext,
            event,
          });
          return { accepted: true };
        }
        const claimId = `${event.interventionId}:${event.revision}:${Date.now().toString(36)}`;
        const accepted = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            const pending = this.pendingInterventionClaims.get(claimId);
            if (pending === undefined) return;
            this.pendingInterventionClaims.delete(claimId);
            pending.resolve(false);
          }, 5_000);
          this.pendingInterventionClaims.set(claimId, { resolve, context: eventContext, timeout });
          this.options.sendFrame({
            type: 'intervention-claim',
            id: claimId,
            context: eventContext,
            event,
          });
        });
        return { accepted };
      });
    }
  }

  private requireSession(sessionId: string): RuntimeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`unknown session: ${sessionId}`);
    }
    return session;
  }

  private assertSessionContext(session: RuntimeSession, context: WorkerFrameContext): void {
    if (
      context.sessionId !== session.productSessionId ||
      context.runtimeGenerationId !== session.context.runtimeGenerationId
    ) {
      throw new Error('worker frame context does not belong to the session generation');
    }
  }

  private abortPendingToolCalls(sessionId: string): void {
    for (const [toolCallId, pending] of this.pendingToolCalls) {
      if (pending.sessionId !== sessionId) continue;
      this.pendingToolCalls.delete(toolCallId);
      pending.controller.abort();
      pending.resolve({ ok: false, code: 'aborted', message: 'tool proxy aborted' });
    }
    this.sessionToolCallControllers.delete(sessionId);
  }

  private deleteSessionAliases(session: RuntimeSession): void {
    this.sessions.delete(session.productSessionId);
    if (session.workerSessionId !== session.productSessionId) {
      this.sessions.delete(session.workerSessionId);
    }
  }

  private rejectPendingCallsForDroppedSession(session: RuntimeSession): void {
    const droppedSessionError = new Error(`session dropped: ${session.productSessionId}`);
    for (const [toolCallId, pending] of this.pendingToolCalls) {
      if (pending.sessionId !== session.productSessionId) continue;
      this.pendingToolCalls.delete(toolCallId);
      this.removeSessionToolCallController(pending);
      pending.controller.abort();
      pending.reject(droppedSessionError);
    }
    this.sessionToolCallControllers.delete(session.productSessionId);

    for (const [requestId, pending] of this.pendingExtensionUiRequests) {
      if (pending.sessionId !== session.productSessionId) continue;
      this.pendingExtensionUiRequests.delete(requestId);
      pending.reject(droppedSessionError);
    }

    for (const [claimId, pending] of this.pendingInterventionClaims) {
      if (pending.context.sessionId !== session.productSessionId) continue;
      this.pendingInterventionClaims.delete(claimId);
      clearTimeout(pending.timeout);
      pending.resolve(false);
    }
  }

  private removeSessionToolCallController(pending: PendingToolCall): void {
    const controllers = this.sessionToolCallControllers.get(pending.sessionId);
    controllers?.delete(pending.controller);
    if (controllers && controllers.size === 0) {
      this.sessionToolCallControllers.delete(pending.sessionId);
    }
  }

  private sendResponse(id: string, success: boolean, data: unknown, error?: string): void {
    const context = this.requestContexts.get(id);
    this.requestContexts.delete(id);
    if (!context) {
      return;
    }
    if (success) {
      this.options.sendFrame({ type: 'response', id, context, success: true, data });
    } else {
      this.options.sendFrame({
        type: 'response',
        id,
        context,
        success: false,
        error: error ?? 'unknown error',
      });
    }
  }
}

function sameFrameContext(left: WorkerFrameContext, right: WorkerFrameContext): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.runtimeGenerationId === right.runtimeGenerationId &&
    left.runId === right.runId &&
    left.toolCallId === right.toolCallId
  );
}

/** Map a single raw Pi event to a normalized AgentEvent (test helper). */
export function mapSinglePiEvent(mapper: PiSessionEventMapper, raw: unknown): AgentEvent[] {
  return mapper.map(raw).map((wrapped) => wrapped.event);
}
