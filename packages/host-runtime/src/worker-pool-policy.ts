/**
 * Derive worker-pool / supervisor / subagent-quota ceilings from
 * `subagents.maxConcurrency` and hot-apply them onto the live Host.
 */

import { availableParallelism } from 'node:os';
import {
  DEFAULT_SUBAGENT_MAX_CONCURRENCY,
  deriveSubagentQuota,
  deriveSupervisorMaxWorkers,
  deriveWorkerPoolSize,
  type HostPush,
  type HostRuntimeResourcesData,
} from '@piwin/contracts';
import {
  WorkerCapacityExhaustedError,
  type AgentWorkerSupervisor,
} from '@piwin/agent-host';

/** Mutable Host fields the pool policy writes. */
export type WorkerPoolApplyTarget = {
  workerPoolSize: number;
  supervisorMax: number;
  subagentQuota: number;
  workerPoolOverParallelismLogged: boolean;
  workerCapacityExhaustWarnLogged: boolean;
  agentWorkerSupervisor: { setMaxActiveWorkers(next: number): void } | null;
  runtimeResourceCoordinator: { setConfiguredMaxConcurrency(max: number): void } | null;
  residencyController: { revisitCapacity(): void };
  push: (message: HostPush) => void;
};

/** Snapshot of live worker-pool metrics for `host/runtime-resources`. */
export function buildWorkersResourceBlock(input: {
  workerPoolSize: number;
  subagentQuota: number;
  supervisor: {
    getStatus(): {
      maxActiveWorkers: number;
      activeWorkers: number;
      startingWorkers: number;
    };
  } | null;
  ephemeral: number;
  subagentWaiting: number;
}): HostRuntimeResourcesData['workers'] {
  if (!input.supervisor) return undefined;
  const status = input.supervisor.getStatus();
  return {
    pool: input.workerPoolSize,
    max: status.maxActiveWorkers,
    active: status.activeWorkers,
    starting: status.startingWorkers,
    subagent: input.ephemeral,
    subagentMax: input.subagentQuota,
    subagentWaiting: input.subagentWaiting,
  };
}

/**
 * Recompute pool / supervisor / quota from N and push them onto live
 * supervisor, coordinator, and residency. Idempotent. `undefined` N uses the
 * product default.
 */
export function applyWorkerPoolSize(
  deps: WorkerPoolApplyTarget,
  maxConcurrency: number | undefined,
  parallelism = availableParallelism(),
): void {
  const poolSize = deriveWorkerPoolSize(maxConcurrency ?? DEFAULT_SUBAGENT_MAX_CONCURRENCY);
  const supervisorMax = deriveSupervisorMaxWorkers(
    maxConcurrency ?? DEFAULT_SUBAGENT_MAX_CONCURRENCY,
  );
  const quota = deriveSubagentQuota(maxConcurrency ?? DEFAULT_SUBAGENT_MAX_CONCURRENCY);
  deps.workerPoolSize = poolSize;
  deps.supervisorMax = supervisorMax;
  deps.subagentQuota = quota;
  deps.agentWorkerSupervisor?.setMaxActiveWorkers(supervisorMax);
  deps.runtimeResourceCoordinator?.setConfiguredMaxConcurrency(quota);
  deps.residencyController.revisitCapacity();
  if (!deps.workerPoolOverParallelismLogged && poolSize > parallelism) {
    deps.workerPoolOverParallelismLogged = true;
    deps.push({
      type: 'host/log',
      level: 'info',
      message: `[workers] pool size ${poolSize} exceeds os.availableParallelism()=${parallelism}; workers are I/O-bound so this is informational`,
    });
  }
}

/** Log once and rethrow — hitting the supervisor cap means the ledger and process count disagree. */
export function guardWorkerAcquire(supervisor: AgentWorkerSupervisor, deps: WorkerPoolApplyTarget): AgentWorkerSupervisor {
  const original = supervisor.acquireWorker.bind(supervisor);
  supervisor.acquireWorker = (sessionId, runtimeGenerationId, workerOptions) =>
    original(sessionId, runtimeGenerationId, workerOptions).catch((error: unknown) => {
      if (error instanceof WorkerCapacityExhaustedError && !deps.workerCapacityExhaustWarnLogged) {
        deps.workerCapacityExhaustWarnLogged = true;
        deps.push({
          type: 'host/log',
          level: 'warn',
          message: `[workers] capacity exhausted (active ${error.active} + starting ${error.starting} >= max ${error.max}); residency should have queued`,
        });
      }
      throw error;
    });
  return supervisor;
}
