import type { HostRuntimeResourcesData } from '@piwin/contracts';

export function formatRuntimeResourcesLines(data: HostRuntimeResourcesData): string[] {
  const lines = [
    `runtime residency: resident=${data.counts.resident} idle=${data.counts.idle} busy=${data.counts.busy} activating=${data.counts.activating} suspending=${data.counts.suspending} waiters=${data.waiterCount}`,
    `runtime budget: maxResident=${data.budget.maxResidentRuntimes} maxIdle=${data.budget.maxIdleRuntimes} highWaterMiB=${data.budget.memoryHighWaterMiB} lowWaterMiB=${data.budget.memoryLowWaterMiB}`,
    `runtime memory: hostRssMiB=${data.memory.hostRssMiB}${data.memory.workerRssMiB !== undefined ? ` workerRssMiB=${data.memory.workerRssMiB}` : ''} sample=${data.memory.sampleCompleteness}`,
    `runtime evictions: ttl=${data.counters.evictedByIdleTtl} maxIdle=${data.counters.evictedByMaxIdle} maxResident=${data.counters.evictedByMaxResident} memory=${data.counters.evictedByMemoryPressure} pressureFail=${data.counters.memoryPressureFailures}`,
  ];
  if (data.workers) {
    lines.push(
      `runtime workers: ${data.workers.active}/${data.workers.pool} active (${data.workers.starting} starting) · subagents ${data.workers.subagent}/${data.workers.subagentMax} · waiting ${data.workers.subagentWaiting}`,
    );
  }
  return lines;
}
