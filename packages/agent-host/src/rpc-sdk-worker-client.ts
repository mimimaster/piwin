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
  type WorkerRequest,
  type WorkerRequestPayload,
  type WorkerResponse,
} from './rpc-sdk-worker-protocol.js';
import type { AgentEvent, SubagentTaskResult, SubagentTaskSpec, SubagentWorkspaceLease } from '@piwin/contracts';

export type WorkerClientOptions = {
  /** Path to the worker entry script. Defaults to the bundled entry. */
  workerScript?: string;
  /** Additional args passed to the Node process. */
  nodeArgs?: string[];
  /** Env vars for the worker process. */
  env?: Record<string, string>;
  /** Called when the worker emits a normalized event. */
  onEvent?: (sessionId: string, event: AgentEvent) => void;
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

  constructor(options: WorkerClientOptions = {}) {
    super();
    this.options = options;
  }

  /** Start the worker child process. */
  start(): void {
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
      this.emit('exit', code);
    });
  }

  /** Send a request and wait for the response. */
  async request(payload: WorkerRequestPayload): Promise<WorkerResponse> {
    if (!this.child || this.exited) {
      throw new Error('worker not running');
    }
    const id = randomUUID();
    const request: WorkerRequest = { type: 'request', id, method: payload.method, payload };
    return new Promise<WorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
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
  }): Promise<{ sessionId: string }> {
    const response = await this.request({
      method: 'session/create',
      ...input,
    });
    if (!response.success) throw new Error(response.error ?? 'session/create failed');
    return response.data as { sessionId: string };
  }

  /** Prompt a session in the worker. Returns when the prompt completes. */
  async prompt(sessionId: string, text: string): Promise<void> {
    const response = await this.request({ method: 'session/prompt', sessionId, text });
    if (!response.success) throw new Error(response.error ?? 'session/prompt failed');
  }

  /** Abort a running prompt in the worker. */
  async abort(sessionId: string): Promise<void> {
    const response = await this.request({ method: 'session/abort', sessionId });
    if (!response.success) throw new Error(response.error ?? 'session/abort failed');
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
    if (frame.type === 'response') {
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        pending.resolve(frame as WorkerResponse);
      }
    } else if (frame.type === 'event') {
      this.options.onEvent?.(frame.sessionId, frame.event);
      this.emit('event', frame.sessionId, frame.event);
    }
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
}

/**
 * Create a `SubagentTaskRunner` backed by the worker client. The orchestrator
 * uses this to run tasks in an isolated process.
 */
export function createWorkerTaskRunner(client: RpcSdkWorkerClient): {
  start(task: SubagentTaskSpec, workspace: SubagentWorkspaceLease, signal: AbortSignal): Promise<SubagentTaskResult>;
  cancel(childSessionId: string): Promise<void>;
} {
  return {
    async start(task, workspace, signal) {
      const session = await client.createSession({
        projectPath: workspace.cwd,
        workingDirectory: workspace.cwd,
        isolation: workspace.mode,
        ...(task.profileId ? { profileId: task.profileId } : {}),
        ...(task.model ? {
          modelProtocol: task.model.protocol,
          modelProviderId: task.model.providerId,
          modelModelId: task.model.modelId,
        } : {}),
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
