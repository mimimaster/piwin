/**
 * CE-WORKER: Agent worker supervisor — manages isolated Pi worker processes.
 *
 * Phase 3 runtime refactor: Worker Isolation and Backend Parity.
 *
 * WI-01: Product RPC uses a piwin-owned Node child process.
 * WI-02: One worker owns one (sessionId, runtimeGenerationId) pair.
 * WI-03: A worker is never reused across sessions or generations.
 * WI-04: Worker lifetime equals runtime-generation lifetime.
 * WI-05: Parent Host owns permissions and all side-effect tool execution.
 * WI-06: Worker owns only Pi session execution, streaming, and event mapping.
 * WI-09: Capacity exhaustion waits or fails explicitly; never changes backend.
 * WI-13: Agent worker processes are internal infrastructure, not Phase 1 Jobs.
 * WI-14: agent-host owns worker spawn/termination; does not import @piwin/process.
 * WI-15: No automatic idle eviction ships in this phase.
 */

import { RpcSdkWorkerClient, type WorkerClientOptions } from './rpc-sdk-worker-client.js';
import type { AgentEvent, HostToolExecutionResult } from '@piwin/contracts';
import type { WorkerToolCallFrame } from './rpc-sdk-worker-protocol.js';
import type {
  SerializableBlueprint,
  SerializableProviderRuntime,
} from './rpc/serializable-blueprint.js';

/** Runtime settings for the worker supervisor (internal, not user PiwinConfig). */
export type AgentWorkerRuntimeSettings = {
  maxActiveWorkers: number;
  startupTimeoutMs: number;
  shutdownTimeoutMs: number;
  maxFrameBytes: number;
};

/** Default settings computed from available parallelism. */
export function computeDefaultWorkerSettings(): AgentWorkerRuntimeSettings {
  const maybeParallelism = (globalThis as unknown as Record<string, unknown>).availableParallelism;
  const availableParallelism =
    typeof maybeParallelism === 'function' ? (maybeParallelism as () => number)() : 4;
  const maxActiveWorkers = Math.min(Math.max(2, availableParallelism - 1), 8);
  return {
    maxActiveWorkers,
    startupTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
    maxFrameBytes: 8 * 1024 * 1024,
  };
}

/** A managed worker instance with its associated session/generation. */
interface ManagedWorker {
  client: RpcSdkWorkerClient;
  sessionId: string;
  runtimeGenerationId: string;
  /** Whether the worker has been disposed. */
  disposed: boolean;
}

/** Options for the supervisor. */
export type AgentWorkerSupervisorOptions = {
  settings?: Partial<AgentWorkerRuntimeSettings>;
  /** Source-mode/test overrides for the packaged worker process. */
  worker?: Omit<WorkerClientOptions, 'onEvent' | 'onToolCall' | 'onExtensionUiRequest'>;
  /** Parent-owned execution port for compiled Host tool descriptors. */
  onToolCall?: (
    frame: WorkerToolCallFrame,
    signal: AbortSignal,
  ) => Promise<HostToolExecutionResult>;
  /** Called when a worker emits a normalized AgentEvent. */
  onEvent?: (sessionId: string, event: AgentEvent) => void;
  /** Called for an unexpected worker exit with its owned generation identity. */
  onWorkerExit?: (identity: {
    sessionId: string;
    runtimeGenerationId: string;
    code: number | null;
  }) => void;
  /** Extension UI request handler. */
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

/** Status of the worker supervisor. */
export type WorkerSupervisorStatus = {
  activeWorkers: number;
  maxActiveWorkers: number;
  /** Always true — this supervisor reports process isolation. */
  processIsolation: boolean;
};

/** Aggregate worker RSS sample (ADR 0040 §8). */
export type WorkerRssSample = {
  /** Sum of sampled worker RSS in MiB. */
  rssMiB: number;
  sampledWorkers: number;
  totalWorkers: number;
  /** 'complete' when every worker answered; 'partial'/'missing' otherwise. */
  sampleCompleteness: 'complete' | 'partial' | 'missing';
};

/**
 * AgentWorkerSupervisor: manages isolated Pi worker processes.
 *
 * WI-02: One worker owns one (sessionId, runtimeGenerationId) pair.
 * WI-09: Capacity exhaustion waits or fails explicitly.
 *
 * The supervisor is the only authority for worker process lifecycle.
 * It is NOT a JobController consumer (WI-13).
 */
export class AgentWorkerSupervisor {
  private readonly settings: AgentWorkerRuntimeSettings;
  private readonly workerOptions: AgentWorkerSupervisorOptions['worker'];
  private readonly onToolCall: AgentWorkerSupervisorOptions['onToolCall'];
  private readonly onEvent: ((sessionId: string, event: AgentEvent) => void) | undefined;
  private readonly onExtensionUiRequest: AgentWorkerSupervisorOptions['onExtensionUiRequest'];
  private readonly onWorkerExit: AgentWorkerSupervisorOptions['onWorkerExit'];
  private readonly workers = new Map<string, ManagedWorker>();
  /** Workers keyed by (sessionId, runtimeGenerationId). */
  private readonly bySessionGeneration = new Map<string, string>();
  /** In-flight starts keyed by (sessionId, runtimeGenerationId). */
  private readonly pendingAcquires = new Map<string, Promise<RpcSdkWorkerClient>>();
  private disposed = false;

  constructor(options: AgentWorkerSupervisorOptions = {}) {
    const defaults = computeDefaultWorkerSettings();
    this.settings = {
      maxActiveWorkers: options.settings?.maxActiveWorkers ?? defaults.maxActiveWorkers,
      startupTimeoutMs: options.settings?.startupTimeoutMs ?? defaults.startupTimeoutMs,
      shutdownTimeoutMs: options.settings?.shutdownTimeoutMs ?? defaults.shutdownTimeoutMs,
      maxFrameBytes: options.settings?.maxFrameBytes ?? defaults.maxFrameBytes,
    };
    this.onToolCall = options.onToolCall;
    this.onEvent = options.onEvent;
    this.onExtensionUiRequest = options.onExtensionUiRequest;
    this.onWorkerExit = options.onWorkerExit;
    this.workerOptions = options.worker;
  }

  /** Get the current supervisor status. */
  getStatus(): WorkerSupervisorStatus {
    return {
      activeWorkers: this.workers.size,
      maxActiveWorkers: this.settings.maxActiveWorkers,
      processIsolation: true,
    };
  }

  /** Check if capacity is available for a new worker. */
  hasCapacity(): boolean {
    return this.workers.size < this.settings.maxActiveWorkers;
  }

  /**
   * Acquire a worker for a (sessionId, runtimeGenerationId) pair.
   * WI-02: One worker owns one pair.
   * WI-09: If capacity is exhausted, throws an explicit error.
   *
   * If a worker already exists for this pair, returns it.
   */
  async acquireWorker(
    sessionId: string,
    runtimeGenerationId: string,
    workerOptions?: WorkerClientOptions,
  ): Promise<RpcSdkWorkerClient> {
    if (this.disposed) {
      throw new Error('AgentWorkerSupervisor is disposed');
    }

    const key = `${sessionId}:${runtimeGenerationId}`;
    const existingId = this.bySessionGeneration.get(key);
    if (existingId) {
      const existing = this.workers.get(existingId);
      if (existing && !existing.disposed) {
        return existing.client;
      }
    }

    const pending = this.pendingAcquires.get(key);
    if (pending) return pending;

    if (this.workers.size + this.pendingAcquires.size >= this.settings.maxActiveWorkers) {
      throw new Error(
        `worker capacity exhausted (${this.workers.size}/${this.settings.maxActiveWorkers})`,
      );
    }

    const acquisition = this.startWorker(sessionId, runtimeGenerationId, key, workerOptions);
    this.pendingAcquires.set(key, acquisition);
    try {
      return await acquisition;
    } finally {
      if (this.pendingAcquires.get(key) === acquisition) {
        this.pendingAcquires.delete(key);
      }
    }
  }

  private async startWorker(
    sessionId: string,
    runtimeGenerationId: string,
    key: string,
    workerOptions?: WorkerClientOptions,
  ): Promise<RpcSdkWorkerClient> {
    if (!this.hasCapacity()) {
      throw new Error(
        `worker capacity exhausted (${this.workers.size}/${this.settings.maxActiveWorkers})`,
      );
    }

    const clientOptions: ConstructorParameters<typeof RpcSdkWorkerClient>[0] = {
      ...this.workerOptions,
      ...workerOptions,
      context: { sessionId, runtimeGenerationId },
      helloTimeoutMs: this.settings.startupTimeoutMs,
    };
    if (this.onToolCall) clientOptions.onToolCall = this.onToolCall;
    if (this.onEvent) clientOptions.onEvent = this.onEvent;
    if (this.onExtensionUiRequest) clientOptions.onExtensionUiRequest = this.onExtensionUiRequest;
    const client = new RpcSdkWorkerClient(clientOptions);

    const workerId = `worker-${sessionId}-${runtimeGenerationId}`;
    const managed: ManagedWorker = {
      client,
      sessionId,
      runtimeGenerationId,
      disposed: false,
    };
    this.workers.set(workerId, managed);
    this.bySessionGeneration.set(key, workerId);

    // Clean up on exit.
    client.on('exit', (code: number | null) => {
      this.workers.delete(workerId);
      this.bySessionGeneration.delete(key);
      if (!managed.disposed && !this.disposed) {
        this.onWorkerExit?.({
          sessionId,
          runtimeGenerationId,
          code,
        });
      }
    });

    try {
      await client.start();
    } catch (error) {
      // The worker is already registered before startup so an exit during
      // hello negotiation cannot escape the supervisor's lifecycle maps.
      managed.disposed = true;
      this.workers.delete(workerId);
      this.bySessionGeneration.delete(key);
      try {
        client.forceKill();
        await client.close();
      } catch {
        // RpcSdkWorkerClient performs best-effort cleanup at its boundary.
      }
      throw error;
    }

    return client;
  }

  /**
   * Release a worker for a (sessionId, runtimeGenerationId) pair.
   * WI-04: Worker lifetime equals runtime-generation lifetime.
   */
  async releaseWorker(sessionId: string, runtimeGenerationId: string): Promise<void> {
    const key = `${sessionId}:${runtimeGenerationId}`;
    const workerId = this.bySessionGeneration.get(key);
    if (!workerId) return;

    const managed = this.workers.get(workerId);
    if (!managed || managed.disposed) return;

    managed.disposed = true;
    try {
      await managed.client.close();
    } catch {
      // best-effort close
    }
    this.workers.delete(workerId);
    this.bySessionGeneration.delete(key);
  }

  /** Release every worker belonging to one runtime generation. */
  async releaseGeneration(runtimeGenerationId: string): Promise<void> {
    const ownedPairs = [...this.workers.values()]
      .filter((worker) => worker.runtimeGenerationId === runtimeGenerationId)
      .map((worker) => ({ sessionId: worker.sessionId, runtimeGenerationId }));
    await Promise.all(
      ownedPairs.map((pair) => this.releaseWorker(pair.sessionId, pair.runtimeGenerationId)),
    );
  }

  /** Get the worker for a session/generation pair, if it exists. */
  getWorker(sessionId: string, runtimeGenerationId: string): RpcSdkWorkerClient | undefined {
    const key = `${sessionId}:${runtimeGenerationId}`;
    const workerId = this.bySessionGeneration.get(key);
    if (!workerId) return undefined;
    const managed = this.workers.get(workerId);
    return managed?.client;
  }

  /**
   * Aggregate current worker RSS (ADR 0040 §8). Each worker answers a strict,
   * bounded resource query with its `process.memoryUsage()` snapshot. The
   * aggregate never exposes per-process PIDs or secrets. Missing/stale
   * answers mark the sample incomplete so no false low-memory claim is made.
   */
  async sampleAggregateWorkerRssMiB(timeoutMs = 750): Promise<WorkerRssSample> {
    const workers = [...this.workers.values()];
    if (workers.length === 0) {
      return {
        rssMiB: 0,
        sampledWorkers: 0,
        totalWorkers: 0,
        sampleCompleteness: 'complete',
      };
    }
    const results = await Promise.allSettled(
      workers.map((worker) => worker.client.requestResourceSnapshot(timeoutMs)),
    );
    let rssBytes = 0;
    let sampledWorkers = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        rssBytes += result.value.memory.rssBytes;
        sampledWorkers += 1;
      }
    }
    const sampleCompleteness: WorkerRssSample['sampleCompleteness'] =
      sampledWorkers === workers.length
        ? 'complete'
        : sampledWorkers > 0
          ? 'partial'
          : 'missing';
    return {
      rssMiB: Math.round(rssBytes / 1024 / 1024),
      sampledWorkers,
      totalWorkers: workers.length,
      sampleCompleteness,
    };
  }

  /**
   * Create a session in a worker for the given session/generation pair.
   * Acquires a worker if one doesn't exist.
   */
  async createSession(
    sessionId: string,
    runtimeGenerationId: string,
    blueprint: SerializableBlueprint,
    providers?: SerializableProviderRuntime[],
  ): Promise<string> {
    const client = await this.acquireWorker(sessionId, runtimeGenerationId);
    const result = await client.createSession({
      productSessionId: sessionId,
      blueprint,
      ...(providers ? { providers } : {}),
    });
    return result.sessionId;
  }

  /** Dispose all workers (graceful then forceful within deadline). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;

    const workers = [...this.workers.values()];
    this.workers.clear();
    this.bySessionGeneration.clear();

    await Promise.all(
      workers.map(async (worker) => {
        worker.disposed = true;
        try {
          // Race graceful shutdown against a force-kill timeout
          await Promise.race([
            worker.client.close(),
            new Promise<void>((resolve) => setTimeout(resolve, this.settings.shutdownTimeoutMs)),
          ]);
        } catch {
          // Ignore graceful shutdown errors
        }
        // Force-kill the process if still alive
        try {
          worker.client.forceKill();
        } catch {
          // Ignore
        }
      }),
    );
  }
}
