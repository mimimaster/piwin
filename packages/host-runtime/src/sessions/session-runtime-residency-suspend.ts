/**
 * Suspension transaction for the residency controller (ADR 0040 §6).
 * Deduplicates in-flight Host cleanup by session id.
 */

import type { SessionRuntimeEvictionReason } from '@piwin/contracts';
import type {
  ResidentRuntimeEntry,
  ResidencyCounters,
  SuspendResult,
} from './session-runtime-residency-types.js';
import type { SuspensionWaiter } from './session-runtime-residency-waiters.js';

export type SuspensionTransition = {
  runtimeGenerationId: string;
  promise: Promise<boolean>;
};

export type ResidencySuspendDeps = {
  entries: Map<string, ResidentRuntimeEntry>;
  counters: ResidencyCounters;
  suspensionWaiters: Map<string, SuspensionWaiter[]>;
  suspensionTransitions: Map<string, SuspensionTransition>;
  nowMs: () => number;
  getIdleTtlMs: () => number;
  publish: (entry: ResidentRuntimeEntry) => void;
  stopSweepTimerIfIdle: () => void;
  grantWaiters: () => void;
  suspendRuntime?: ((input: {
    sessionId: string;
    runtimeGenerationId: string;
    reason: SessionRuntimeEvictionReason;
  }) => Promise<boolean>) | undefined;
};

export function beginSuspend(
  deps: ResidencySuspendDeps,
  sessionId: string,
  runtimeGenerationId: string,
  reason: SessionRuntimeEvictionReason,
): SuspendResult {
  const entry = deps.entries.get(sessionId);
  if (!entry) return { ok: false, reason: 'not-resident' };
  if (entry.runtimeGenerationId !== runtimeGenerationId) {
    return { ok: false, reason: 'generation-mismatch' };
  }
  // Deduplicate a second suspension for the same in-flight transition.
  if (entry.state === 'suspending') {
    return { ok: true, status: 'started' };
  }
  if (entry.protectionCount > 0 || entry.state === 'resident-busy') {
    return { ok: false, reason: 'protected' };
  }
  entry.state = 'suspending';
  entry.lastEvictionReason = reason;
  deps.publish(entry);
  return { ok: true, status: 'started' };
}

export function finishSuspend(
  deps: ResidencySuspendDeps,
  sessionId: string,
  runtimeGenerationId: string,
): void {
  const entry = deps.entries.get(sessionId);
  if (
    !entry ||
    entry.state !== 'suspending' ||
    entry.runtimeGenerationId !== runtimeGenerationId
  ) {
    return;
  }
  const reason = entry.lastEvictionReason ?? 'idle-ttl';
  switch (reason) {
    case 'idle-ttl':
      deps.counters.evictedByIdleTtl += 1;
      break;
    case 'max-idle':
      deps.counters.evictedByMaxIdle += 1;
      break;
    case 'max-resident':
      deps.counters.evictedByMaxResident += 1;
      break;
    case 'memory-pressure':
      deps.counters.evictedByMemoryPressure += 1;
      break;
    default:
      break;
  }
  deps.entries.delete(sessionId);
  deps.stopSweepTimerIfIdle();
  const suspensionResolvers = deps.suspensionWaiters.get(sessionId);
  if (suspensionResolvers) {
    deps.suspensionWaiters.delete(sessionId);
    for (const resolver of suspensionResolvers) {
      resolver.resolve();
    }
  }
  deps.grantWaiters();
}

/**
 * Restore a `suspending` runtime to `resident-idle` when the Host cleanup
 * transaction fails (e.g. recorder flush failed) so the runtime stays
 * resident instead of leaking detached state (ADR 0040 §6).
 */
export function abortSuspend(
  deps: ResidencySuspendDeps,
  sessionId: string,
  runtimeGenerationId: string,
): boolean {
  const entry = deps.entries.get(sessionId);
  if (
    !entry ||
    entry.state !== 'suspending' ||
    entry.runtimeGenerationId !== runtimeGenerationId
  ) {
    return false;
  }
  const idleTtlMs = deps.getIdleTtlMs();
  entry.state = 'resident-idle';
  entry.lastUsedAtMs = deps.nowMs();
  entry.idleDeadlineMs = idleTtlMs > 0 ? entry.lastUsedAtMs + idleTtlMs : entry.lastUsedAtMs;
  deps.publish(entry);
  const suspensionResolvers = deps.suspensionWaiters.get(sessionId);
  if (suspensionResolvers) {
    deps.suspensionWaiters.delete(sessionId);
    for (const resolver of suspensionResolvers) {
      resolver.reject(new Error('runtime suspension aborted'));
    }
  }
  return true;
}

export function requestSuspend(
  deps: ResidencySuspendDeps,
  sessionId: string,
  runtimeGenerationId: string,
  reason: SessionRuntimeEvictionReason,
): Promise<boolean> {
  const existingTransition = deps.suspensionTransitions.get(sessionId);
  if (existingTransition) {
    if (existingTransition.runtimeGenerationId === runtimeGenerationId) {
      return existingTransition.promise;
    }
    return Promise.resolve(false);
  }
  const started = beginSuspend(deps, sessionId, runtimeGenerationId, reason);
  if (!started.ok) {
    return Promise.resolve(false);
  }
  const transition = (async () => {
    let suspended = true;
    try {
      suspended =
        (await deps.suspendRuntime?.({ sessionId, runtimeGenerationId, reason })) ?? true;
    } catch {
      suspended = false;
    }
    if (suspended) {
      finishSuspend(deps, sessionId, runtimeGenerationId);
      return true;
    }
    abortSuspend(deps, sessionId, runtimeGenerationId);
    return false;
  })().finally(() => {
    const current = deps.suspensionTransitions.get(sessionId);
    if (current?.promise === transition) {
      deps.suspensionTransitions.delete(sessionId);
    }
  });
  deps.suspensionTransitions.set(sessionId, { runtimeGenerationId, promise: transition });
  return transition;
}
