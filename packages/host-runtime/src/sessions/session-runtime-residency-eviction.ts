/**
 * Idle-victim selection and admission eviction for the residency controller.
 * Selection is pure; suspension is performed through the injected callback.
 */

import type { SessionRuntimeEvictionReason } from '@piwin/contracts';
import type {
  ResidentRuntimeEntry,
  ResidencyMemorySample,
} from './session-runtime-residency-types.js';

export type EvictIdleForAdmissionDeps = {
  entries: Map<string, ResidentRuntimeEntry>;
  nowMs: () => number;
  getMaxIdleRuntimes: () => number;
  resolveMaxResidentRuntimes: () => number;
  sampleMemory?: (() => ResidencyMemorySample) | undefined;
  getMemoryHighWaterMiB: () => number | undefined;
  isRuntimeProtected?: ((sessionId: string) => boolean) | undefined;
  requestSuspend: (
    sessionId: string,
    runtimeGenerationId: string,
    reason: SessionRuntimeEvictionReason,
  ) => Promise<boolean>;
};

/** Highest-priority idle victim candidates. Never includes protected runtimes. */
export function collectIdleVictims(
  entries: Iterable<ResidentRuntimeEntry>,
  nowMs: number,
  isRuntimeProtected?: ((sessionId: string) => boolean) | undefined,
): ResidentRuntimeEntry[] {
  return [...entries]
    .filter(
      (entry) =>
        entry.state === 'resident-idle' &&
        entry.ephemeral !== true &&
        entry.protectionCount === 0 &&
        isRuntimeProtected?.(entry.sessionId) !== true,
    )
    .sort((left, right) => {
      // Expired idle first, then least-recently-used; tie-break by stable id.
      const leftExpired = left.idleDeadlineMs !== undefined && left.idleDeadlineMs <= nowMs;
      const rightExpired = right.idleDeadlineMs !== undefined && right.idleDeadlineMs <= nowMs;
      if (leftExpired !== rightExpired) return leftExpired ? -1 : 1;
      if (left.lastUsedAtMs !== right.lastUsedAtMs) {
        return left.lastUsedAtMs - right.lastUsedAtMs;
      }
      return left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0;
    });
}

export function idleCount(entries: Iterable<ResidentRuntimeEntry>): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.state === 'resident-idle') count += 1;
  }
  return count;
}

export function aggregateRssMiB(
  sampleMemory: (() => ResidencyMemorySample) | undefined,
): number | undefined {
  if (!sampleMemory) return undefined;
  const sample = sampleMemory();
  if (sample.sampleCompleteness !== 'complete') return undefined;
  return sample.hostRssMiB + (sample.workerRssMiB ?? 0);
}

export function effectiveMemoryBudgetMiB(
  memoryHighWaterMiB: number | undefined,
): { highWaterMiB: number; lowWaterMiB: number } | undefined {
  if (memoryHighWaterMiB === undefined) return undefined;
  return { highWaterMiB: memoryHighWaterMiB, lowWaterMiB: Math.round(memoryHighWaterMiB * 0.8) };
}

/** Suspend idle victims in LRU order until count and memory are under target. */
export async function evictIdleForAdmission(deps: EvictIdleForAdmissionDeps): Promise<void> {
  const maxResident = deps.resolveMaxResidentRuntimes();
  const memoryBudget = effectiveMemoryBudgetMiB(deps.getMemoryHighWaterMiB());

  for (const victim of collectIdleVictims(
    deps.entries.values(),
    deps.nowMs(),
    deps.isRuntimeProtected,
  )) {
    const countUnder = deps.entries.size < maxResident;
    const idleOver = idleCount(deps.entries.values()) > deps.getMaxIdleRuntimes();
    const rssMiB = aggregateRssMiB(deps.sampleMemory);
    // High-water eviction targets the low-water mark (ADR 0040 §3):
    // release idle runtimes until aggregate RSS falls to the low water.
    const memoryOver =
      memoryBudget !== undefined && rssMiB !== undefined && rssMiB > memoryBudget.lowWaterMiB;
    if (countUnder && !idleOver && !memoryOver) {
      break;
    }
    // Deterministic reason: prefer the most specific binding constraint.
    let reason: SessionRuntimeEvictionReason;
    if (idleOver) reason = 'max-idle';
    else if (memoryOver) reason = 'memory-pressure';
    else reason = 'max-resident';
    await deps.requestSuspend(victim.sessionId, victim.runtimeGenerationId, reason);
  }
}

/**
 * TTL-expired idle runtimes, in map iteration order. Re-checks live state
 * before each suspend so a concurrent transition can drop a candidate.
 */
export async function suspendExpiredIdleEntries(deps: {
  entries: Map<string, ResidentRuntimeEntry>;
  nowMs: number;
  isRuntimeProtected?: ((sessionId: string) => boolean) | undefined;
  requestSuspend: (
    sessionId: string,
    runtimeGenerationId: string,
    reason: SessionRuntimeEvictionReason,
  ) => Promise<boolean>;
}): Promise<void> {
  for (const entry of [...deps.entries.values()]) {
    if (entry.ephemeral === true) continue;
    if (entry.state !== 'resident-idle' || entry.protectionCount > 0) continue;
    if (deps.isRuntimeProtected?.(entry.sessionId) === true) continue;
    if (entry.idleDeadlineMs !== undefined && entry.idleDeadlineMs <= deps.nowMs) {
      await deps.requestSuspend(entry.sessionId, entry.runtimeGenerationId, 'idle-ttl');
    }
  }
}
