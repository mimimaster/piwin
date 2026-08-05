/** Pi worker/RPC backend adapter. Product composition remains in host-runtime. */

import type {
  BackendSessionHandle,
  CreateBackendSessionInput,
  PiSessionBackend,
} from './backends/pi-session-backend.js';
import {
  WorkerSessionBackend,
  type WorkerSessionBackendOptions,
} from './backends/worker-rpc-session-backend.js';
import { AgentWorkerSupervisor } from './agent-worker-supervisor.js';

export type PiRpcAdapterOptions = {
  worker?: WorkerSessionBackendOptions['worker'];
  supervisor?: AgentWorkerSupervisor;
  command?: string;
  mock?: boolean;
};

/**
 * Backend-only RPC facade. Stock Pi RPC is intentionally not used as a
 * product path because it cannot receive piwin's compiled tools/resources.
 * RPC mode always means a piwin-owned worker process.
 */
export class PiRpcAdapter implements PiSessionBackend {
  readonly mode = 'rpc-worker' as const;
  readonly isolated = true;
  private readonly workerBackend: WorkerSessionBackend | null;
  private readonly supervisor: AgentWorkerSupervisor | null;
  private readonly ownsSupervisor: boolean;

  constructor(options: PiRpcAdapterOptions = {}) {
    if (options.mock !== true && process.env.PIWIN_MOCK !== '1') {
      this.supervisor = options.supervisor ?? new AgentWorkerSupervisor(
        options.worker ? { worker: options.worker } : {},
      );
      this.ownsSupervisor = options.supervisor === undefined;
      this.workerBackend = new WorkerSessionBackend({
        supervisor: this.supervisor,
        ...(options.worker ? { worker: options.worker } : {}),
        disposeSupervisor: this.ownsSupervisor,
      });
    } else {
      this.workerBackend = null;
      this.supervisor = null;
      this.ownsSupervisor = false;
    }
  }

  isIsolated(): boolean {
    return this.workerBackend !== null;
  }

  async createSession(input: CreateBackendSessionInput): Promise<BackendSessionHandle> {
    if (!this.workerBackend) {
      throw new Error(
        'rpc-backend-not-ready: stock Pi RPC cannot consume compiled piwin backend inputs; enable the piwin worker backend',
      );
    }
    return this.workerBackend.createSession(input);
  }

  async dropSession(sessionId: string): Promise<void> {
    await this.workerBackend?.dropSession(sessionId);
  }

  async dropSessionGeneration(sessionId: string, runtimeGenerationId: string): Promise<void> {
    await this.workerBackend?.dropSessionGeneration(sessionId, runtimeGenerationId);
  }

  async dispose(): Promise<void> {
    await this.workerBackend?.dispose();
  }
}
