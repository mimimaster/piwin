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
import { resolve as resolvePath } from 'node:path';
import {
  parseWorkerFrame,
  serializeWorkerRequest,
  type WorkerFrame,
  type WorkerHelloFrame,
  type WorkerRequest,
  type WorkerRequestPayload,
  type WorkerResponse,
  type WorkerToolCallFrame,
  type WorkerToolResultFrame,
} from './rpc-sdk-worker-protocol.js';
import type {
  AgentEvent,
  SubagentTaskResult,
  SubagentTaskSpec,
  SubagentWorkspaceLease,
} from '@piwin/contracts';
import type { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';
import type {
  SerializableBlueprint,
  SerializableProviderRuntime,
} from './rpc/serializable-blueprint.js';

export type WorkerClientOptions = {
  /** Path to the worker entry script. Defaults to the bundled entry. */
  workerScript?: string;
  /** Additional args passed to the Node process. */
  nodeArgs?: string[];
  /** Env vars for the worker process. */
  env?: Record<string, string>;
  /** Called when the worker emits a normalized event. */
  onEvent?: (sessionId: string, event: AgentEvent) => void;
  /**
   * WP4: parent-owned tool execution router. When provided, the client
   * routes `tool-call` frames from the worker to this router and sends
   * `tool-result` frames back. The router owns permission/MCP/process/browser.
   */
  toolRouter?: HostToolExecutionRouter;
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
   * Phase 7 §4.4: timeout (ms) for session/prompt ack.
   * Default 2000ms. Long generation continues via events.
   */
  promptAckTimeoutMs?: number;
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
};

type PendingRequest = {
  resolve: (response: WorkerResponse) => void;
  reject: (error: Error) => void;
};

export class RpcSdkWorkerClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly options: WorkerClientOptions;
  private exited = false;
  private exitCode: number | null = null;
  private helloReceived = false;
  private helloResolve: ((hello: WorkerHelloFrame) => void) | null = null;
  private helloReject: ((error: Error) => void) | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: WorkerClientOptions = {}) {
    super();
    this.options = options;
  }

  /** Start the worker child process and wait for hello handshake. */
  async start(): Promise<void> {
    if (this.child) return;
    const script =
      this.options.workerScript ??
      resolvePath(new URL('./rpc-sdk-worker-entry.js', import.meta.url).pathname);
    const args = [...(this.options.nodeArgs ?? []), script];
    this.child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.options.env },
    });
    this.child.stdout?.setEncoding('utf8');
    this.child.stderr?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => this.handleStdout(chunk));
    this.child.stderr?.on('data', (chunk: string) => {
      // Diagnostics only; never secrets.
      this.emit('log', chunk.trim());
    });
    this.child.on('exit', (code) => {
      this.exited = true;
      this.exitCode = code;
      this.rejectAllPending(`worker exited with code ${code}`);
      if (this.helloReject && !this.helloReceived) {
        this.helloReject(new Error(`worker exited before hello (code ${code})`));
      }
      if (this.helloTimer) {
        clearTimeout(this.helloTimer);
        this.helloTimer = null;
      }
      this.emit('exit', code);
    });

    // Wait for hello handshake with timeout (§4.4: 5s default).
    const helloTimeout = this.options.helloTimeoutMs ?? 5000;
    await new Promise<void>((resolve, reject) => {
      this.helloResolve = (hello) => {
        this.helloReceived = true;
        this.helloTimer && clearTimeout(this.helloTimer);
        this.helloTimer = null;
        // Validate protocol version (§4.3: parent refuses incompatible workers).
        if (hello.protocolVersion !== 1) {
          reject(
            new Error(`worker protocol version ${hello.protocolVersion} incompatible (expected 1)`),
          );
          return;
        }
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
  }

  /** Send a request and wait for the response with optional timeout. */
  async request(payload: WorkerRequestPayload, timeoutMs?: number): Promise<WorkerResponse> {
    if (!this.child || this.exited) {
      throw new Error('worker not running');
    }
    if (!this.helloReceived) {
      throw new Error('worker hello not received — call start() first');
    }
    const id = randomUUID();
    const request: WorkerRequest = { type: 'request', id, method: payload.method, payload };
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
      this.child!.stdin?.write(serializeWorkerRequest(request) + '\n');
    });
  }

  /** Create a session in the worker. */
  async createSession(input: {
    projectPath: string;
    workingDirectory: string;
    isolation: 'readonly' | 'worktree';
    profileId?: string;
    modelProtocol?: string;
    modelProviderId?: string;
    modelModelId?: string;
    thinkingLevel?: string;
    capabilities?: string[];
    skillIds?: string[];
  }): Promise<{ sessionId: string }>;
  async createSession(input: {
    productSessionId: string;
    blueprint: SerializableBlueprint;
    providers?: SerializableProviderRuntime[];
  }): Promise<{ sessionId: string }>;
  async createSession(input: {
    projectPath: string;
    workingDirectory: string;
    isolation: 'readonly' | 'worktree';
    profileId?: string;
    modelProtocol?: string;
    modelProviderId?: string;
    modelModelId?: string;
    thinkingLevel?: string;
    capabilities?: string[];
    skillIds?: string[];
  }): Promise<{ sessionId: string }>;
  async createSession(input: {
    productSessionId: string;
    blueprint: SerializableBlueprint;
    providers?: SerializableProviderRuntime[];
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
      thinkingLevel?: string;
      model?: { providerId: string; modelId: string };
    },
  ): Promise<void> {
    const response = await this.request(
      {
        method: 'session/prompt',
        sessionId,
        text,
        ...(options?.images ? { images: options.images } : {}),
        ...(options?.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
        ...(options?.model ? { model: options.model } : {}),
      },
      this.options.promptAckTimeoutMs ?? 2000,
    );
    if (!response.success) throw new Error(response.error ?? 'session/prompt failed');
  }

  /** Abort a running prompt in the worker. */
  async abort(sessionId: string): Promise<void> {
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

  /** Drop a session in the worker (cleanup). */
  async dropSession(sessionId: string): Promise<void> {
    const response = await this.request({ method: 'session/drop', sessionId });
    if (!response.success) throw new Error(response.error ?? 'session/drop failed');
  }

  /** Terminate the worker process. */
  async close(): Promise<void> {
    if (!this.child) return;
    this.child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      if (this.exited) {
        resolve();
        return;
      }
      this.once('exit', () => resolve());
    });
  }

  private handleStdout(chunk: string): void {
    const lines = chunk.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const frame = parseWorkerFrame(trimmed);
      if (!frame) continue;
      this.handleFrame(frame);
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
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        pending.resolve(frame as WorkerResponse);
      }
    } else if (frame.type === 'event') {
      this.options.onEvent?.(frame.sessionId, frame.event);
      this.emit('event', frame.sessionId, frame.event);
    } else if (frame.type === 'tool-call') {
      void this.handleToolCall(frame).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.emit('log', `[worker-client] tool-call error: ${message}`);
      });
    }
  }

  /**
   * WP4: route a tool-call frame from the worker to the parent's
   * HostToolExecutionRouter and send the result back.
   */
  private async handleToolCall(frame: WorkerToolCallFrame): Promise<void> {
    const router = this.options.toolRouter;
    if (!router) {
      this.sendToolResult(frame.id, false, undefined, 'no tool router configured');
      return;
    }
    const args = (frame.args ?? {}) as Record<string, unknown>;
    const result = await router.execute(frame.toolName, args);
    if (result.ok) {
      this.sendToolResult(frame.id, true, result.output);
    } else {
      this.sendToolResult(frame.id, false, undefined, result.message, result.code);
    }
  }

  private sendToolResult(
    id: string,
    ok: boolean,
    result: unknown,
    error?: string,
    code?: 'tool-not-available' | 'tool-disabled' | 'permission-denied' | 'aborted',
  ): void {
    let frame: WorkerToolResultFrame;
    if (ok) {
      frame = { type: 'tool-result', id, ok: true, result };
    } else {
      frame = {
        type: 'tool-result',
        id,
        ok: false,
        error: error ?? 'unknown error',
        ...(code ? { code } : {}),
      };
    }
    this.child?.stdin?.write(`${JSON.stringify(frame)}\n`);
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      pending.reject(new Error(reason));
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

/**
 * Create a `SubagentTaskRunner` backed by the worker client. The orchestrator
 * uses this to run tasks in an isolated process.
 */
export function createWorkerTaskRunner(client: RpcSdkWorkerClient): {
  start(
    task: SubagentTaskSpec,
    workspace: SubagentWorkspaceLease,
    signal: AbortSignal,
  ): Promise<SubagentTaskResult>;
  cancel(childSessionId: string): Promise<void>;
} {
  return {
    async start(task, workspace, signal) {
      const session = await client.createSession({
        projectPath: workspace.cwd,
        workingDirectory: workspace.cwd,
        isolation: workspace.mode,
        ...(task.profileId ? { profileId: task.profileId } : {}),
        ...(task.model
          ? {
              modelProtocol: task.model.protocol,
              modelProviderId: task.model.providerId,
              modelModelId: task.model.modelId,
            }
          : {}),
        ...(task.thinkingLevel ? { thinkingLevel: task.thinkingLevel } : {}),
      });
      const childSessionId = session.sessionId;

      // Abort propagation.
      signal.addEventListener('abort', () => {
        void client.abort(childSessionId).catch(() => {});
      });

      try {
        await client.prompt(childSessionId, task.task);
        return {
          runId: 'worker',
          taskId: task.id,
          childSessionId,
          executionStatus: 'completed',
          summaryStatus: 'not-requested',
          integrationStatus: workspace.mode === 'worktree' ? 'pending' : 'not-requested',
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled = signal.aborted;
        return {
          runId: 'worker',
          taskId: task.id,
          childSessionId,
          executionStatus: cancelled ? 'cancelled' : 'failed',
          summaryStatus: 'not-requested',
          integrationStatus: 'not-requested',
          error: message,
          ...(workspace.worktreePath ? { worktreePath: workspace.worktreePath } : {}),
        };
      }
    },
    async cancel(childSessionId) {
      await client.abort(childSessionId).catch(() => {});
    },
  };
}
