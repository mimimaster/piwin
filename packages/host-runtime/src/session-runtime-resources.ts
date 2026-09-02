import {
  DEFAULT_MAX_CONCURRENT_RUNS,
  deriveMemoryLowWaterMiB,
  type HostRuntimeResourcesData,
} from '@piwin/contracts';
import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import { buildWorkersResourceBlock } from './worker-pool-policy.js';

export function getRuntimeResources(deps: HostRuntimeKernel): HostRuntimeResourcesData {
  const counts = deps.residencyController.getCounts();
  const counters = deps.residencyController.getCounters();
  const maxResidentRuntimes = deps.residencyController.getMaxResidentRuntimes();
  const worker = deps.workerRssSample;
  const execution = deps.runtimeResourceCoordinator?.getStatus();
  const workers = buildWorkersResourceBlock({
    workerPoolSize: deps.workerPoolSize,
    subagentQuota: deps.subagentQuota,
    supervisor: deps.agentWorkerSupervisor,
    ephemeral: counts.ephemeral,
    subagentWaiting: deps.runtimeResourceCoordinator?.getStatus().waitingSubagentRuns ?? 0,
  });
  return {
    counts: {
      resident: counts.resident,
      idle: counts.residentIdle,
      busy: counts.residentBusy,
      activating: counts.activating,
      suspending: counts.suspending,
    },
    waiterCount: counts.waiterCount,
    budget: {
      maxResidentRuntimes,
      maxIdleRuntimes: deps.runtimeRetention.maxIdleRuntimes,
      memoryHighWaterMiB: deps.runtimeMemoryHighWaterMiB,
      memoryLowWaterMiB: deriveMemoryLowWaterMiB(deps.runtimeMemoryHighWaterMiB),
    },
    memory: {
      hostRssMiB: Math.max(1, Math.round(process.memoryUsage().rss / 1024 / 1024)),
      ...(worker && worker.rssMiB > 0 ? { workerRssMiB: worker.rssMiB } : {}),
      sampleCompleteness: worker?.completeness ?? 'missing',
    },
    counters: {
      evictedByIdleTtl: counters.evictedByIdleTtl,
      evictedByMaxIdle: counters.evictedByMaxIdle,
      evictedByMaxResident: counters.evictedByMaxResident,
      evictedByMemoryPressure: counters.evictedByMemoryPressure,
      memoryPressureFailures: counters.memoryPressureFailures,
    },
    execution: execution
      ? {
          configuredMaxConcurrentRuns: execution.configuredMaxConcurrentRuns,
          effectiveMaxConcurrentRuns: execution.effectiveMaxConcurrentRuns,
          activeRuns: execution.activeRuns,
          waitingRuns: execution.waitingRuns,
          activeForegroundRuns: execution.activeForegroundRuns,
          waitingForegroundRuns: execution.waitingForegroundRuns,
          activeSubagentRuns: execution.activeSubagentRuns,
          waitingSubagentRuns: execution.waitingSubagentRuns,
          subagentMaxConcurrency: execution.subagentMaxConcurrency,
          ...(execution.limitingReason ? { limitingReason: execution.limitingReason } : {}),
        }
      : {
          configuredMaxConcurrentRuns: DEFAULT_MAX_CONCURRENT_RUNS,
          effectiveMaxConcurrentRuns: Math.min(
            DEFAULT_MAX_CONCURRENT_RUNS,
            Math.max(1, maxResidentRuntimes),
          ),
          activeRuns: 0,
          waitingRuns: 0,
          activeForegroundRuns: 0,
          waitingForegroundRuns: 0,
          activeSubagentRuns: 0,
          waitingSubagentRuns: 0,
          subagentMaxConcurrency: deps.subagentQuota,
          ...(maxResidentRuntimes < DEFAULT_MAX_CONCURRENT_RUNS
            ? { limitingReason: 'runtime-residency' as const }
            : {}),
        },
    ...(workers ? { workers } : {}),
  };
}
