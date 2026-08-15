/**
 * CE-SUB-ORCH: client for the piwin-owned isolated SDK worker.
 *
 * Owns the child process, request map, abort propagation, exit handling,
 * and cleanup. The worker runs a PiSdkAdapter inside the child process.
 * The client exposes a `SubagentTaskRunner`-compatible interface so the
 * orchestrator can delegate without knowing about child_process.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  parseWorkerFrame,
  serializeWorkerRequest,
  serializeWorkerResourceRequest,
  type WorkerExtensionUiRequestFrame,
  type WorkerExtensionUiResponseFrame,
  type WorkerFrame,
  type WorkerFrameContext,
  type WorkerHelloFrame,
  type WorkerRequest,
  type WorkerRequestPayload,
  type WorkerResourceResponseFrame,
  type WorkerResponse,
  type WorkerToolCallFrame,
  type WorkerToolResultFrame,
  type WorkerInterventionClaimFrame,
  type WorkerInterventionPermitFrame,
} from './rpc-sdk-worker-protocol.js';
import type {
  AgentEvent,
  BackendRunIntervention,
  HostToolExecutionResult,
  SessionCompactResult,
  SessionSeedMessage,
  EphemeralProviderSecret,
} from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { encodeWorkerSecretBootstrap } from './rpc/worker-secret-bootstrap.js';
import type {
  SerializableBlueprint,
  SerializableWorkerProviderRuntime,
} from './rpc/serializable-blueprint.js';

export type WorkerClientOptions = {
  /** Path to the worker entry script. Defaults to the bundled entry. */
  workerScript?: string;
  /** Additional args passed to the Node process. */
  nodeArgs?: string[];
  /** Env vars for the worker process. */
  env?: Record<string, string>;
  /**
   * In-memory provider keys sent once over the dedicated bootstrap pipe. Raw
   * values are never included in JSONL frames, argv, or worker environment.
   */
  bootstrapSecrets?: readonly EphemeralProviderSecret[];
  /** Supervisor-owned identity for this worker generation. */
  context?: Pick<WorkerFrameContext, 'sessionId' | 'runtimeGenerationId'>;
  /** Called when the worker emits a normalized event. */
  onEvent?: (sessionId: string, event: AgentEvent) => void;
  /** Backend-neutral parent execution port for exact Host tool descriptors. */
  onToolCall?: (
    frame: WorkerToolCallFrame,
    signal: AbortSignal,
  ) => Promise<HostToolExecutionResult>;
  /**
   * Phase 7 §4.4: timeout (ms) for worker start/hello handshake.
   * Default 5000ms. If the worker does not send hello within this window,
   * start() rejects with an actionable error.
   */
  helloTimeoutMs?: number;
  /**
   * Phase 7 §4.4: timeout (ms) for session/create requests.
   * Default 30000ms (includes provider registration + resource load).
   */
  createTimeoutMs?: number;
  /**
   * Optional timeout (ms) for the full session/prompt completion.
   *
   * The worker sends this response only after Pi finishes the generation, so
   * it is intentionally disabled by default. Worker exit and explicit abort
   * still reject the pending prompt request.
   */
  promptCompletionTimeoutMs?: number;
  /**
   * Phase 7 §4.4: timeout (ms) for tool-call roundtrip.
   * Default 600000ms (10 min). Parent may ask user for permission.
   */
  toolCallTimeoutMs?: number;
  /**
   * Phase 7 §4.4: timeout (ms) for abort ack.
   * Default 2000ms. Must not block control lane.
   */
  abortTimeoutMs?: number;
  /**
   * Phase 7 §3.2: extension UI request handler. When provided, the client
   * routes `extension-ui-request` frames from the worker to this handler
   * and sends `extension-ui-response` frames back. The parent owns the
   * Desktop/CLI modal display.
   */
  onExtensionUiRequest?: (request: {
    sessionId: string;
    runtimeGenerationId: string;
    kind: 'confirm' | 'select' | 'input';
    title: string;
    message?: string;
    options?: string[];
    placeholder?: string;
  }) => Promise<
    | { kind: 'confirm'; confirmed: boolean }
    | { kind: 'select'; value?: string; cancelled?: boolean }
    | { kind: 'input'; value?: string; cancelled?: boolean }
  >;
};

type PendingRequest = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
};

/** Pending internal resource queries (ADR 0040 §8), correlated by frame id. */
type PendingResourceQuery = {
  resolve: (frame: WorkerResourceResponseFrame) => void;
  reject: (error: Error) => void;
};

export class RpcSdkWorkerClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pendingResource = new Map<string, PendingResourceQuery>();
  private readonly options: WorkerClientOptions;
  private exited = false;
  private exitCode: number | null = null;
  private helloReceived = false;
  private helloResolve: ((hello: WorkerHelloFrame) => void) | null = null;
  private helloReject: ((error: Error) => void) | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private startPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private exitPromise: Promise<void> | null = null;
  private resolveExit: (() => void) | null = null;
  private stdoutBuffer = '';
  private readonly toolCallControllers = new Map<
    string,
    { sessionId: string; controller: AbortController }
  >();

  constructor(options: WorkerClientOptions = {}) {
    super();
    this.options = options;
  }

  /** Start the worker child process and wait for hello handshake. */
  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.child && !this.exited) return;

    this.startPromise = this.startWorker();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startWorker(): Promise<void> {
    const script = this.options.workerScript ?? resolveDefaultWorkerScript();
    const args = [...(this.options.nodeArgs ?? []), script];
    const workerEnvironment: Record<string, string> = {};
    if (process.env.PATH) workerEnvironment.PATH = process.env.PATH;
    if (process.env.NODE_ENV) workerEnvironment.NODE_ENV = process.env.NODE_ENV;
    Object.assign(workerEnvironment, this.options.env ?? {});
    // Validate and bound the payload before allocating a child process.
    const bootstrapFrame = encodeWorkerSecretBootstrap(this.options.bootstrapSecrets ?? []);

    this.exited = false;
    this.exitCode = null;
    this.helloReceived = false;
    this.stdoutBuffer = '';
    try {
      this.child = spawn(process.execPath, args, {
        stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        env: workerEnvironment,
      });
    } catch (error) {
      const startupError = error instanceof Error ? error : new Error(String(error));
      await this.cleanupAfterStartupFailure(startupError);
      throw startupError;
    }

    const child = this.child;
    this.exitPromise = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });
    this.child.stdout?.setEncoding('utf8');
    this.child.stderr?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => this.handleStdout(chunk));
    this.child.stderr?.on('data', (chunk: string) => {
      // Diagnostics only; never secrets.
      this.emit('log', chunk.trim());
    });
    child.on('error', (error) => {
      if (!this.helloReceived) {
        this.helloReject?.(error);
        return;
      }
      this.rejectAllPending(`worker process error: ${error.message}`);
      this.abortOutstandingToolCalls();
      this.emit('log', `[worker-client] worker process error: ${error.message}`);
    });
    child.on('exit', (code) => {
      this.exited = true;
      this.exitCode = code;
      this.rejectAllPending(`worker exited with code ${code}`);
      this.abortOutstandingToolCalls();
      if (this.helloReject && !this.helloReceived) {
        this.helloReject(new Error(`worker exited before hello (code ${code})`));
      }
      this.clearHelloWait();
      this.resolveExit?.();
      this.resolveExit = null;
      this.exitPromise = null;
      this.child = null;
      this.emit('exit', code);
    });

    // Install the hello waiter before writing fd 3. A tiny worker can finish
    // bootstrap and emit hello in the same event-loop turn.
    const helloTimeout = this.options.helloTimeoutMs ?? 5000;
    const helloPromise = new Promise<void>((resolve, reject) => {
      this.helloResolve = (hello) => {
        // Validate protocol version (§4.3: parent refuses incompatible workers).
        if (hello.protocolVersion !== 1) {
          this.clearHelloWait();
          reject(
            new Error(`worker protocol version ${hello.protocolVersion} incompatible (expected 1)`),
          );
          return;
        }
        if (
          (this.options.bootstrapSecrets?.length ?? 0) > 0 &&
          hello.capabilities.providerSecretBootstrap !== true
        ) {
          this.clearHelloWait();
          reject(new Error('worker does not support provider secret bootstrap'));
          return;
        }
        this.helloReceived = true;
        this.clearHelloWait();
        resolve();
      };
      this.helloReject = reject;
      this.helloTimer = setTimeout(() => {
        if (!this.helloReceived) {
          reject(
            new Error(
              `worker hello timeout after ${helloTimeout}ms — worker may be stuck or misconfigured`,
            ),
          );
        }
      }, helloTimeout);
    });

    try {
      const bootstrap = child.stdio?.[3];
      const bootstrapPromise =
        bootstrap instanceof Writable
          ? writeWorkerSecretBootstrap(bootstrap, bootstrapFrame)
          : Promise.reject(new Error('worker secret bootstrap pipe is unavailable'));
      await Promise.all([bootstrapPromise, helloPromise]);
    } catch (error: unknown) {
      const startupError = error instanceof Error ? error : new Error(String(error));
      await this.cleanupAfterStartupFailure(startupError);
      throw startupError;
    }
  }

  /** Send a request and wait for the response with optional timeout. */
  async request(
    payload: WorkerRequestPayload,
    timeoutMs?: number,
    contextOverrides?: Pick<WorkerFrameContext, 'runId'>,
  ): Promise<WorkerResponse> {
    if (!this.child || this.exited) {
      throw new Error('worker not running');
    }
    if (!this.helloReceived) {
      throw new Error('worker hello not received — call start() first');
    }
    const id = randomUUID();
    const baseContext = this.options.context;
    if (!baseContext) {
      throw new Error('worker identity context is not configured');
    }
    const context: WorkerFrameContext = { ...baseContext, ...(contextOverrides ?? {}) };
    const request: WorkerRequest = {
      type: 'request',
      id,
      method: payload.method,
      context,
      payload,
    };
    const child = this.child;
    if (!child) throw new Error('worker stopped before request could be sent');
    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = timeoutMs
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`request ${payload.method} timed out after ${timeoutMs}ms`));
          }, timeoutMs)
        : null;
      this.pending.set(id, {
        resolve: (response) => {
          if (timer) clearTimeout(timer);
          resolve(response);
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          reject(error);
        },
      });
      try {
        child.stdin?.write(serializeWorkerRequest(request) + '\n');
      } catch (error) {
        this.pending.delete(id);
        if (timer) clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Query the worker's current memory usage (ADR 0040 §8). Strict bounded
   * frame with a short timeout; used for aggregate Host/worker RSS pressure.
   */
  async requestResourceSnapshot(timeoutMs = 1000): Promise<WorkerResourceResponseFrame> {
    if (!this.child || this.exited) {
      throw new Error('worker not running');
    }
    if (!this.helloReceived) {
      throw new Error('worker hello not received — call start() first');
    }
    const id = randomUUID();
    const child = this.child;
    return new Promise<WorkerResourceResponseFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResource.delete(id);
        reject(new Error(`worker resource query timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingResource.set(id, {
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        child.stdin?.write(serializeWorkerResourceRequest({ type: 'resource-request', id }) + '\n');
      } catch (error) {
        this.pendingResource.delete(id);
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Create a session in the worker from the compiled backend blueprint. */
  async createSession(input: {
    productSessionId: string;
    blueprint: SerializableBlueprint;
    providers?: SerializableWorkerProviderRuntime[];
    seedMessages?: readonly SessionSeedMessage[];
    seedMode?: 'compaction' | 'replay';
  }): Promise<{ sessionId: string }>;
  async createSession(input: unknown): Promise<{ sessionId: string }> {
    const response = await this.request(
      {
        method: 'session/create',
        ...(input as Record<string, unknown>),
      } as WorkerRequestPayload,
      this.options.createTimeoutMs ?? 30000,
    );
    if (!response.success) throw new Error(response.error ?? 'session/create failed');
    return response.data as { sessionId: string };
  }

  /** Prompt a session in the worker. Returns when the prompt completes. */
  async prompt(
    sessionId: string,
    text: string,
    options?: {
      images?: Array<{ mimeType: string; dataBase64: string }>;
      streamingBehavior?: 'steer' | 'followUp';
      thinkingLevel?: string;
      model?: { providerId: string; modelId: string };
      runId?: string;
    },
  ): Promise<void> {
    const response = await this.request(
      {
        method: 'session/prompt',
        sessionId,
        text,
        ...(options?.images ? { images: options.images } : {}),
        ...(options?.streamingBehavior ? { streamingBehavior: options.streamingBehavior } : {}),
        ...(options?.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
        ...(options?.model ? { model: options.model } : {}),
      },
      this.options.promptCompletionTimeoutMs,
      options?.runId ? { runId: options.runId } : undefined,
    );
    if (!response.success) throw new Error(response.error ?? 'session/prompt failed');
  }

  /** Abort a running prompt in the worker. */
  async abort(sessionId: string): Promise<void> {
    this.abortToolCallsForSession(sessionId);
    const response = await this.request(
      { method: 'session/abort', sessionId },
      this.options.abortTimeoutMs ?? 2000,
    );
    if (!response.success) throw new Error(response.error ?? 'session/abort failed');
  }

  /** Steer an in-flight run with a new user message. */
  async steer(sessionId: string, message: string): Promise<void> {
    const response = await this.request({ method: 'session/steer', sessionId, message });
    if (!response.success) throw new Error(response.error ?? 'session/steer failed');
  }

  /** Follow up on a completed run. */
  async followUp(sessionId: string, message: string): Promise<void> {
    const response = await this.request({ method: 'session/follow-up', sessionId, message });
    if (!response.success) throw new Error(response.error ?? 'session/follow-up failed');
  }

  async armRunIntervention(sessionId: string, intervention: BackendRunIntervention): Promise<void> {
    const response = await this.request(
      { method: 'session/intervention-arm', sessionId, intervention },
      undefined,
      { runId: intervention.runId },
    );
    if (!response.success) {
      throw new Error(response.error ?? 'session/intervention-arm failed');
    }
  }

  async cancelRunIntervention(
    sessionId: string,
    interventionId: string,
    expectedRevision: number,
  ): Promise<boolean> {
    const response = await this.request({
      method: 'session/intervention-cancel',
      sessionId,
      interventionId,
      expectedRevision,
    });
    if (!response.success) {
      throw new Error(response.error ?? 'session/intervention-cancel failed');
    }
    return (response.data as { cancelled?: boolean } | undefined)?.cancelled === true;
  }

  /** Compact a session in the worker and return the normalized result. */
  async compact(sessionId: string, customInstructions?: string): Promise<SessionCompactResult> {
    const response = await this.request({
      method: 'session/compact',
      sessionId,
      ...(customInstructions ? { customInstructions } : {}),
    });
    if (!response.success) throw new Error(response.error ?? 'session/compact failed');
    return response.data as SessionCompactResult;
  }

  /** Abort an in-flight compaction in the worker. */
  async abortCompaction(sessionId: string): Promise<void> {
    const response = await this.request(
      { method: 'session/compact-abort', sessionId },
      this.options.abortTimeoutMs ?? 2000,
    );
    if (!response.success) throw new Error(response.error ?? 'session/compact-abort failed');
  }

  /** Drop a session in the worker (cleanup). */
  async dropSession(sessionId: string): Promise<void> {
    const response = await this.request({ method: 'session/drop', sessionId });
    if (!response.success) throw new Error(response.error ?? 'session/drop failed');
  }

  /** Terminate the worker process. */
  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closePromise = this.closeWorker().finally(() => {
      this.closePromise = null;
    });
    return this.closePromise;
  }

  private async closeWorker(): Promise<void> {
    this.abortOutstandingToolCalls();
    const child = this.child;
    if (!child || this.exited) return;
    child.kill('SIGTERM');
    await this.exitPromise;
  }

  /** Force-kill the worker process with SIGKILL (no graceful shutdown). */
  forceKill(): void {
    if (!this.child || this.exited) return;
    this.abortOutstandingToolCalls();
    try {
      this.child.kill('SIGKILL');
    } catch {
      // best-effort; process may have already exited
    }
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const frame = parseWorkerFrame(trimmed);
      if (frame) {
        this.handleFrame(frame);
      } else {
        this.handleUnparsedLine(trimmed);
      }
    }
  }

  private handleUnparsedLine(line: string): void {
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        parsed &&
        typeof parsed === 'object' &&
        'type' in parsed &&
        parsed.type === 'hello' &&
        'protocolVersion' in parsed &&
        typeof parsed.protocolVersion === 'number' &&
        parsed.protocolVersion !== 1
      ) {
        this.helloReject?.(
          new Error(`worker protocol version ${parsed.protocolVersion} incompatible (expected 1)`),
        );
      }
    } catch {
      // Non-protocol diagnostics on stdout are ignored; valid JSONL frames
      // are still preserved by the persistent buffer above.
    }
  }

  private handleFrame(frame: WorkerFrame): void {
    if (frame.type === 'hello') {
      this.helloResolve?.(frame);
      this.helloResolve = null;
      this.helloReject = null;
      this.emit('hello', frame);
    } else if (frame.type === 'shutdown') {
      this.emit('log', `[worker-client] worker shutdown: ${frame.reason}`);
      this.emit('shutdown', frame.reason);
    } else if (frame.type === 'response') {
      if (!this.matchesWorkerContext(frame.context)) {
        this.emit('log', '[worker-client] rejected response from stale worker context');
        return;
      }
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        pending.resolve(frame as WorkerResponse);
      }
    } else if (frame.type === 'event') {
      if (!this.matchesWorkerContext(frame.context)) {
        this.emit('log', '[worker-client] rejected event from stale worker context');
        return;
      }
      this.options.onEvent?.(frame.context.sessionId, frame.event);
      this.emit('event', frame.context.sessionId, frame.event);
    } else if (frame.type === 'tool-call') {
      if (!this.matchesWorkerContext(frame.context)) {
        this.emit('log', '[worker-client] rejected tool call from stale worker context');
        return;
      }
      void this.handleToolCall(frame).catch((error: unknown) => {
        const message = formatError(error);
        this.emit('log', `[worker-client] tool-call error: ${message}`);
      });
    } else if (frame.type === 'extension-ui-request') {
      if (!this.matchesWorkerContext(frame.context)) {
        this.emit('log', '[worker-client] rejected extension UI request from stale worker context');
        return;
      }
      void this.handleExtensionUiRequest(frame).catch((error: unknown) => {
        const message = formatError(error);
        this.emit('log', `[worker-client] extension-ui error: ${message}`);
      });
    } else if (frame.type === 'intervention-claim') {
      if (!this.matchesWorkerContext(frame.context)) return;
      this.emit('intervention-claim', frame);
    } else if (frame.type === 'intervention-event') {
      if (!this.matchesWorkerContext(frame.context)) return;
      this.emit('intervention-event', frame.context.sessionId, frame.event);
    } else if (frame.type === 'resource-response') {
      const pending = this.pendingResource.get(frame.id);
      if (pending) {
        this.pendingResource.delete(frame.id);
        pending.resolve(frame);
      }
    }
  }

  sendInterventionPermit(frame: WorkerInterventionClaimFrame, accepted: boolean): void {
    const child = this.child;
    if (!child || this.exited) return;
    const permit: WorkerInterventionPermitFrame = {
      type: 'intervention-permit',
      id: frame.id,
      context: frame.context,
      accepted,
    };
    child.stdin?.write(`${JSON.stringify(permit)}\n`);
  }

  /**
   * WP4: route a tool-call frame from the worker through the injected parent
   * execution port and send the result back.
   */
  private async handleToolCall(frame: WorkerToolCallFrame): Promise<void> {
    if (this.options.onToolCall) {
      const controller = new AbortController();
      this.toolCallControllers.set(frame.id, {
        sessionId: frame.context.sessionId,
        controller,
      });
      try {
        const result = await this.options.onToolCall(frame, controller.signal);
        this.sendToolResult(frame.id, result, frame.context);
      } catch (error) {
        const message = formatError(error);
        this.sendToolResult(
          frame.id,
          controller.signal.aborted
            ? { ok: false, code: 'aborted', message: 'tool execution aborted' }
            : { ok: false, code: 'execution-failed', message },
          frame.context,
        );
      } finally {
        this.toolCallControllers.delete(frame.id);
      }
      return;
    }
    this.sendToolResult(
      frame.id,
      {
        ok: false,
        code: 'tool-not-available',
        message: 'no HostToolExecutionPort configured',
      },
      frame.context,
    );
  }

  private sendToolResult(
    id: string,
    result: HostToolExecutionResult,
    context: WorkerFrameContext,
  ): void {
    // Keep the complete transport-neutral result under `result`. The worker
    // runtime consumes this field so structured output, details, cancellation
    // and retry metadata survive the RPC boundary. Legacy top-level fields
    // remain present for older worker parsers.
    const frame: WorkerToolResultFrame = result.ok
      ? { type: 'tool-result', id, context, ok: true, result }
      : {
          type: 'tool-result',
          id,
          context,
          ok: false,
          result,
          code: result.code,
          error: result.message,
          message: result.message,
        };
    this.child?.stdin?.write(`${JSON.stringify(frame)}\n`);
  }

  /**
   * Phase 7 §3.2: route an extension-ui-request frame from the worker
   * to the parent's onExtensionUiRequest handler and send the response back.
   */
  private async handleExtensionUiRequest(frame: WorkerExtensionUiRequestFrame): Promise<void> {
    const handler = this.options.onExtensionUiRequest;
    if (!handler) {
      this.sendExtensionUiResponse(
        frame.id,
        false,
        undefined,
        'no extension UI handler configured',
        frame.context,
      );
      return;
    }
    try {
      const result = await handler({
        sessionId: frame.context.sessionId,
        runtimeGenerationId: frame.context.runtimeGenerationId,
        kind: frame.kind,
        title: frame.title,
        ...(frame.message ? { message: frame.message } : {}),
        ...(frame.options ? { options: frame.options } : {}),
        ...(frame.placeholder ? { placeholder: frame.placeholder } : {}),
      });
      this.sendExtensionUiResponse(frame.id, true, result, undefined, frame.context);
    } catch (error: unknown) {
      const message = formatError(error);
      this.sendExtensionUiResponse(frame.id, false, undefined, message, frame.context);
    }
  }

  private sendExtensionUiResponse(
    id: string,
    ok: boolean,
    result?: WorkerExtensionUiResponseFrame['result'],
    error?: string,
    context?: WorkerFrameContext,
  ): void {
    if (!context) return;
    const frame: WorkerExtensionUiResponseFrame = {
      type: 'extension-ui-response',
      id,
      context,
      ok,
      ...(result ? { result } : {}),
      ...(error ? { error } : {}),
    };
    this.child?.stdin?.write(`${JSON.stringify(frame)}\n`);
  }

  private matchesWorkerContext(context: WorkerFrameContext): boolean {
    const expected = this.options.context;
    return (
      expected !== undefined &&
      context.sessionId === expected.sessionId &&
      context.runtimeGenerationId === expected.runtimeGenerationId
    );
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(new Error(reason));
    }
    for (const [id, pending] of this.pendingResource) {
      this.pendingResource.delete(id);
      pending.reject(new Error(reason));
    }
  }

  private clearHelloWait(): void {
    if (this.helloTimer) {
      clearTimeout(this.helloTimer);
      this.helloTimer = null;
    }
    this.helloResolve = null;
    this.helloReject = null;
  }

  private abortOutstandingToolCalls(): void {
    for (const entry of this.toolCallControllers.values()) {
      entry.controller.abort();
    }
    this.toolCallControllers.clear();
  }

  private abortToolCallsForSession(sessionId: string): void {
    for (const [toolCallId, entry] of this.toolCallControllers) {
      if (entry.sessionId === sessionId) {
        entry.controller.abort();
        this.toolCallControllers.delete(toolCallId);
      }
    }
  }

  private async cleanupAfterStartupFailure(error: Error): Promise<void> {
    this.clearHelloWait();
    this.rejectAllPending(error.message);
    this.abortOutstandingToolCalls();
    const child = this.child;
    if (!child || this.exited) {
      return;
    }
    const exitPromise = this.exitPromise;
    try {
      child.kill('SIGTERM');
    } finally {
      if (!this.exited) {
        try {
          child.kill('SIGKILL');
        } catch {
          // The child may have exited between the two kill attempts.
        }
      }
    }
    if (exitPromise) {
      await exitPromise;
    }
  }

  get isRunning(): boolean {
    return this.child !== null && !this.exited;
  }

  /** True when the worker has sent a valid hello handshake. */
  get isReady(): boolean {
    return this.helloReceived && !this.exited;
  }
}

/** Await fd 3 completion so asynchronous EPIPE errors reject startup. */
function writeWorkerSecretBootstrap(stream: Writable, frame: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      stream.off('error', onError);
      stream.off('finish', onFinish);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onFinish = (): void => {
      cleanup();
      resolve();
    };
    stream.once('error', onError);
    stream.once('finish', onFinish);
    try {
      stream.end(frame);
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function resolveDefaultWorkerScript(): string {
  const packagedWorker = fileURLToPath(new URL('./agent-worker.mjs', import.meta.url));
  if (existsSync(packagedWorker)) return packagedWorker;
  const compiledWorker = fileURLToPath(new URL('./rpc-sdk-worker-entry.js', import.meta.url));
  if (existsSync(compiledWorker)) return compiledWorker;
  throw new Error(
    'packaged agent worker artifact is missing; run bundle:host or provide a test workerScript',
  );
}
