/**
 * Pure session runtime residency state machine (ADR 0040 §2–§5).
 *
 * Owns residency policy and transition serialization for Host-owned session
 * runtimes. This module deliberately imports nothing from `@piwin/agent-host`
 * or `@piwin/session`: `@piwin/agent-host` remains the backend release
 * authority through its existing session/generation drop methods, and this
 * controller only decides *when* a runtime may be created or must be
 * suspended.
 *
 * Residency states (ADR 0040 §2):
 * - `cold`         — durable session only; no Host handle, Pi session, or worker.
 * - `activating`   — capacity reserved and a stable runtime generation is being created.
 * - `resident-idle`— runtime exists and has no protected operation.
 * - `resident-busy`— runtime exists and a protected operation is active.
 * - `suspending`   — new work is blocked while recorder/subscription/backend cleanup runs.
 *
 * Concurrency: every transition is deduplicated by session id. Concurrent
 * prompt, resume, Settings replacement, and eviction paths share one
 * in-flight transition promise and compare the expected `runtimeGenerationId`
 * before publication or disposal.
 */

import {
  ABSOLUTE_MAX_RESIDENT_RUNTIMES,
  DEFAULT_MAX_CONCURRENT_RUNS,
  type SessionRuntimeEvictionReason,
  type SessionRuntimeResidency,
  type SessionRuntimeRetentionConfig,
} from '@piwin/contracts';
import {
  aggregateRssMiB,
  effectiveMemoryBudgetMiB,
  evictIdleForAdmission,
  suspendExpiredIdleEntries,
  type EvictIdleForAdmissionDeps,
} from './session-runtime-residency-eviction.js';
import {
  abortSuspend as abortSuspendEntry,
  beginSuspend as beginSuspendEntry,
  finishSuspend as finishSuspendEntry,
  requestSuspend as requestSuspendEntry,
  type ResidencySuspendDeps,
} from './session-runtime-residency-suspend.js';
import type {
  ActivationResult,
  ResidentRuntimeEntry,
  ResidentRuntimeState,
  ResidencyControllerOptions,
  ResidencyCounts,
  ResidencyCounters,
  SessionRuntimeResidencyController,
  SuspendResult,
} from './session-runtime-residency-types.js';
import {
  grantCapacityWaiters,
  queueCapacityWaiter,
  waitForSuspension,
  type CapacityWaiter,
  type SuspensionWaiter,
} from './session-runtime-residency-waiters.js';

export type {
  ActivationResult,
  ResidentRuntimeEntry,
  ResidentRuntimeState,
  ResidencyControllerOptions,
  ResidencyCounts,
  ResidencyCounters,
  ResidencyMemorySample,
  SessionRuntimeResidencyController,
  SuspendResult,
} from './session-runtime-residency-types.js';

export function createSessionRuntimeResidencyController(
  options: ResidencyControllerOptions,
): SessionRuntimeResidencyController {
  const nowMs = options.nowMs ?? (() => Date.now());
  const sampleMemory = options.sampleMemory;
  const sweepIntervalMs = options.sweepIntervalMs ?? 30_000;
  let retention = options.retention;
  let idleTtlMs = retention.idleTtlSeconds * 1000;
  let maxIdleRuntimes = retention.maxIdleRuntimes;

  /** Entries by session id; only non-cold runtimes are present. */
  const entries = new Map<string, ResidentRuntimeEntry>();
  /** FIFO capacity waiters by session id (one in-flight activation per session). */
  const waiters = new Map<string, CapacityWaiter>();
  /** Resolvers waiting for a same-generation suspension to finish. */
  const suspensionWaiters = new Map<string, SuspensionWaiter[]>();
  /** Complete Host suspension transactions, deduplicated by session id. */
  const suspensionTransitions = new Map<
    string,
    { runtimeGenerationId: string; promise: Promise<boolean> }
  >();
  /** Aggregate counters (bounded; no per-session eviction log retained). */
  const counters: ResidencyCounters = {
    evictedByIdleTtl: 0,
    evictedByMaxIdle: 0,
    evictedByMaxResident: 0,
    evictedByMemoryPressure: 0,
    memoryPressureFailures: 0,
  };

  let sweepTimer: ReturnType<typeof setInterval> | undefined;
  let disposed = false;

  function resolveMaxResidentRuntimes(): number {
    const explicit = retention.maxResidentRuntimes;
    if (explicit !== undefined) {
      return Math.max(1, Math.min(explicit, ABSOLUTE_MAX_RESIDENT_RUNTIMES));
    }
    if (options.resolveMaxResidentRuntimes) {
      const resolved = options.resolveMaxResidentRuntimes();
      return Math.max(1, Math.min(resolved, ABSOLUTE_MAX_RESIDENT_RUNTIMES));
    }
    // Adaptive default: product execution cap (8), never Worker or Sub Agent quotas.
    return Math.min(DEFAULT_MAX_CONCURRENT_RUNS, ABSOLUTE_MAX_RESIDENT_RUNTIMES);
  }

  function makeEntry(
    sessionId: string,
    runtimeGenerationId: string,
    state: ResidentRuntimeState,
    ephemeral?: boolean,
  ): ResidentRuntimeEntry {
    const now = nowMs();
    return {
      sessionId,
      runtimeGenerationId,
      state,
      lastUsedAtMs: now,
      protectionCount: 0,
      ...(ephemeral === true ? { ephemeral: true as const } : {}),
    };
  }

  function publish(entry: ResidentRuntimeEntry): void {
    options.onResidencyChanged?.({ ...entry });
  }

  function startSweepTimerIfNeeded(): void {
    if (disposed || sweepTimer !== undefined || entries.size === 0) {
      return;
    }
    sweepTimer = setInterval(() => {
      void sweepNow();
    }, sweepIntervalMs);
    sweepTimer.unref?.();
  }

  function stopSweepTimerIfIdle(): void {
    if (sweepTimer !== undefined && entries.size === 0) {
      clearInterval(sweepTimer);
      sweepTimer = undefined;
    }
  }

  function suspendDeps(): ResidencySuspendDeps {
    return {
      entries,
      counters,
      suspensionWaiters,
      suspensionTransitions,
      nowMs,
      getIdleTtlMs: () => idleTtlMs,
      publish,
      stopSweepTimerIfIdle,
      grantWaiters,
      suspendRuntime: options.suspendRuntime,
    };
  }

  function evictionDeps(): EvictIdleForAdmissionDeps {
    return {
      entries,
      nowMs,
      getMaxIdleRuntimes: () => maxIdleRuntimes,
      resolveMaxResidentRuntimes,
      sampleMemory,
      getMemoryHighWaterMiB: () => retention.memoryHighWaterMiB,
      isRuntimeProtected: options.isRuntimeProtected,
      requestSuspend,
    };
  }

  function grantWaiters(): void {
    grantCapacityWaiters({
      isDisposed: () => disposed,
      waiters,
      entries,
      maxResident: resolveMaxResidentRuntimes(),
      admit: (waiter) => {
        const reservation = makeEntry(
          waiter.sessionId,
          waiter.runtimeGenerationId,
          'activating',
          waiter.ephemeral === true,
        );
        entries.set(waiter.sessionId, reservation);
        publish(reservation);
        startSweepTimerIfNeeded();
      },
    });
  }

  function getResidency(sessionId: string): SessionRuntimeResidency {
    const entry = entries.get(sessionId);
    if (!entry) return 'cold';
    return entry.state;
  }

  function getEntry(sessionId: string): ResidentRuntimeEntry | undefined {
    const entry = entries.get(sessionId);
    return entry ? { ...entry } : undefined;
  }

  function touch(sessionId: string, runtimeGenerationId: string): void {
    const entry = entries.get(sessionId);
    if (!entry || entry.runtimeGenerationId !== runtimeGenerationId) return;
    entry.lastUsedAtMs = nowMs();
    if (entry.state === 'resident-idle') {
      entry.idleDeadlineMs = idleTtlMs > 0 ? entry.lastUsedAtMs + idleTtlMs : entry.lastUsedAtMs;
    }
    publish(entry);
  }

  function updateRetention(nextRetention: SessionRuntimeRetentionConfig): void {
    retention = nextRetention;
    idleTtlMs = retention.idleTtlSeconds * 1000;
    maxIdleRuntimes = retention.maxIdleRuntimes;
    const now = nowMs();
    for (const entry of entries.values()) {
      if (entry.state === 'resident-idle') {
        entry.idleDeadlineMs = idleTtlMs > 0 ? now + idleTtlMs : now;
        publish(entry);
      }
    }
    // A looser resident cap may make queued work admissible without another
    // runtime transitioning idle/released, so revisit the FIFO explicitly.
    void sweepNow().then(() => grantWaiters());
  }

  async function beginActivation(
    sessionId: string,
    runtimeGenerationId: string,
    signal: AbortSignal,
    activationOptions?: { ephemeral?: boolean },
  ): Promise<ActivationResult> {
    const ephemeral = activationOptions?.ephemeral === true;
    if (disposed) {
      throw new Error('host-disposed');
    }
    if (signal.aborted) {
      throw Object.assign(new Error('aborted'), { code: 'aborted' });
    }
    const existingEntry = entries.get(sessionId);
    if (existingEntry) {
      if (existingEntry.runtimeGenerationId === runtimeGenerationId) {
        if (existingEntry.state === 'activating') {
          // Capacity is already reserved for this generation; share the
          // reservation instead of double-admitting the session.
          return Promise.resolve({ ok: true });
        }
        if (existingEntry.state === 'suspending') {
          await waitForSuspension(suspensionWaiters, sessionId, runtimeGenerationId, signal);
          return {
            ok: false,
            code: 'aborted',
            message: 'runtime suspension completed; retry activation with a new generation',
          };
        }
        // resident-idle / resident-busy: already resident.
        touch(sessionId, runtimeGenerationId);
        return Promise.resolve({ ok: true });
      }
      // A different generation is resident. The Host normally suspends first;
      // this path force-releases a stale generation before admitting the
      // replacement so a stale handle can never hold capacity.
      const suspended = await requestSuspend(
        sessionId,
        existingEntry.runtimeGenerationId,
        'manual',
      );
      if (!suspended) {
        return Promise.resolve({
          ok: false,
          code: 'aborted',
          message: 'runtime busy; cannot replace generation',
        });
      }
    }

    // Deduplicate a second concurrent activation for the same waiting session.
    const existingWaiter = waiters.get(sessionId);
    if (existingWaiter) {
      return existingWaiter.promise;
    }

    // Admission: evict idle runtimes before capacity failure.
    await evictIdleForAdmission(evictionDeps());
    if (disposed) {
      throw new Error('host-disposed');
    }
    if (signal.aborted) {
      throw Object.assign(new Error('aborted'), { code: 'aborted' });
    }

    // Memory-pressure gate: fail the activation when idle eviction cannot
    // bring aggregate RSS below the high-water mark.
    const memoryBudget = effectiveMemoryBudgetMiB(retention.memoryHighWaterMiB);
    const rssMiB = aggregateRssMiB(sampleMemory);
    if (memoryBudget && rssMiB !== undefined && rssMiB > memoryBudget.highWaterMiB) {
      counters.memoryPressureFailures += 1;
      return Promise.resolve({
        ok: false,
        code: 'memory-pressure',
        message: `aggregate RSS ${rssMiB}MiB exceeds ${memoryBudget.highWaterMiB}MiB high water`,
      });
    }

    // Capacity is available: reserve immediately.
    if (entries.size < resolveMaxResidentRuntimes()) {
      const reservation = makeEntry(sessionId, runtimeGenerationId, 'activating', ephemeral);
      entries.set(sessionId, reservation);
      publish(reservation);
      startSweepTimerIfNeeded();
      return Promise.resolve({ ok: true });
    }

    // All capacity is occupied by non-idle runtimes: queue a FIFO waiter.
    return queueCapacityWaiter(waiters, sessionId, runtimeGenerationId, signal, ephemeral);
  }

  function commitActivation(sessionId: string, runtimeGenerationId: string): void {
    const entry = entries.get(sessionId);
    if (
      !entry ||
      entry.state !== 'activating' ||
      entry.runtimeGenerationId !== runtimeGenerationId
    ) {
      return;
    }
    entry.lastUsedAtMs = nowMs();
    if (entry.ephemeral === true) {
      entry.state = 'resident-busy';
      delete entry.idleDeadlineMs;
    } else {
      entry.state = 'resident-idle';
      entry.idleDeadlineMs = idleTtlMs > 0 ? entry.lastUsedAtMs + idleTtlMs : entry.lastUsedAtMs;
    }
    publish(entry);
  }

  function abortActivation(sessionId: string, runtimeGenerationId: string): void {
    const entry = entries.get(sessionId);
    if (
      !entry ||
      entry.state !== 'activating' ||
      entry.runtimeGenerationId !== runtimeGenerationId
    ) {
      return;
    }
    entries.delete(sessionId);
    stopSweepTimerIfIdle();
    grantWaiters();
  }

  function markBusy(sessionId: string, runtimeGenerationId: string): void {
    const entry = entries.get(sessionId);
    if (!entry || entry.runtimeGenerationId !== runtimeGenerationId) return;
    if (entry.state === 'resident-idle') {
      entry.state = 'resident-busy';
      delete entry.idleDeadlineMs;
    }
    publish(entry);
  }

  function markIdle(sessionId: string, runtimeGenerationId: string): void {
    const entry = entries.get(sessionId);
    if (!entry || entry.runtimeGenerationId !== runtimeGenerationId) return;
    if (entry.ephemeral === true) {
      return;
    }
    if (entry.state === 'resident-busy') {
      entry.state = 'resident-idle';
    }
    entry.lastUsedAtMs = nowMs();
    entry.idleDeadlineMs = idleTtlMs > 0 ? entry.lastUsedAtMs + idleTtlMs : entry.lastUsedAtMs;
    publish(entry);
    // A newly idle runtime is the immediate LRU candidate for queued work.
    void evictIdleForAdmission(evictionDeps()).then(() => grantWaiters());
  }

  function protect(sessionId: string, runtimeGenerationId: string): boolean {
    const entry = entries.get(sessionId);
    if (!entry || entry.runtimeGenerationId !== runtimeGenerationId) return false;
    entry.protectionCount += 1;
    return true;
  }

  function releaseProtection(sessionId: string, runtimeGenerationId: string): void {
    const entry = entries.get(sessionId);
    if (!entry || entry.runtimeGenerationId !== runtimeGenerationId) return;
    entry.protectionCount = Math.max(0, entry.protectionCount - 1);
    if (entry.protectionCount === 0 && entry.state === 'resident-idle') {
      void evictIdleForAdmission(evictionDeps()).then(() => grantWaiters());
    }
  }

  function isProtected(sessionId: string): boolean {
    const entry = entries.get(sessionId);
    if (!entry) return false;
    return entry.protectionCount > 0 || entry.state === 'resident-busy';
  }

  function beginSuspend(
    sessionId: string,
    runtimeGenerationId: string,
    reason: SessionRuntimeEvictionReason,
  ): SuspendResult {
    return beginSuspendEntry(suspendDeps(), sessionId, runtimeGenerationId, reason);
  }

  function finishSuspend(sessionId: string, runtimeGenerationId: string): void {
    finishSuspendEntry(suspendDeps(), sessionId, runtimeGenerationId);
  }

  function abortSuspend(sessionId: string, runtimeGenerationId: string): boolean {
    return abortSuspendEntry(suspendDeps(), sessionId, runtimeGenerationId);
  }

  function requestSuspend(
    sessionId: string,
    runtimeGenerationId: string,
    reason: SessionRuntimeEvictionReason,
  ): Promise<boolean> {
    return requestSuspendEntry(suspendDeps(), sessionId, runtimeGenerationId, reason);
  }

  function releaseEphemeral(sessionId: string, runtimeGenerationId: string): void {
    const entry = entries.get(sessionId);
    if (!entry || entry.ephemeral !== true || entry.runtimeGenerationId !== runtimeGenerationId) {
      return;
    }
    if (entry.state !== 'activating' && entry.state !== 'resident-busy') {
      return;
    }
    entries.delete(sessionId);
    stopSweepTimerIfIdle();
    grantWaiters();
  }

  function revisitCapacity(): void {
    void sweepNow().then(() => grantWaiters());
  }

  async function sweepNow(): Promise<void> {
    if (disposed) return;
    options.onSweep?.();
    // Expired idle first (TTL), then capacity/idle/memory pressure. A runtime
    // blocked by Host work (active Run, pending permission/UI, compaction,
    // replacement, transition) is never an eviction victim.
    await suspendExpiredIdleEntries({
      entries,
      nowMs: nowMs(),
      isRuntimeProtected: options.isRuntimeProtected,
      requestSuspend,
    });
    await evictIdleForAdmission(evictionDeps());
  }

  function dispose(): void {
    disposed = true;
    if (sweepTimer !== undefined) {
      clearInterval(sweepTimer);
      sweepTimer = undefined;
    }
    for (const waiter of [...waiters.values()]) {
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      waiter.reject(new Error('host-disposed'));
    }
    waiters.clear();
    for (const suspensionResolvers of suspensionWaiters.values()) {
      for (const resolver of suspensionResolvers) {
        resolver.reject(new Error('host-disposed'));
      }
    }
    suspensionWaiters.clear();
    suspensionTransitions.clear();
    entries.clear();
  }

  function getCounts(): ResidencyCounts {
    let activating = 0;
    let residentIdle = 0;
    let residentBusy = 0;
    let suspending = 0;
    let ephemeral = 0;
    for (const entry of entries.values()) {
      if (entry.ephemeral === true) ephemeral += 1;
      switch (entry.state) {
        case 'activating':
          activating += 1;
          break;
        case 'resident-idle':
          residentIdle += 1;
          break;
        case 'resident-busy':
          residentBusy += 1;
          break;
        case 'suspending':
          suspending += 1;
          break;
      }
    }
    return {
      resident: entries.size,
      activating,
      residentIdle,
      residentBusy,
      suspending,
      waiterCount: waiters.size,
      ephemeral,
    };
  }

  function getCounters(): ResidencyCounters {
    return { ...counters };
  }

  function getMaxResidentRuntimes(): number {
    return resolveMaxResidentRuntimes();
  }

  function hasResident(): boolean {
    return entries.size > 0;
  }

  return {
    getResidency,
    getEntry,
    touch,
    updateRetention,
    beginActivation,
    commitActivation,
    abortActivation,
    markBusy,
    markIdle,
    protect,
    releaseProtection,
    isProtected,
    beginSuspend,
    finishSuspend,
    abortSuspend,
    requestSuspend,
    sweepNow,
    releaseEphemeral,
    revisitCapacity,
    dispose,
    getCounts,
    getCounters,
    getMaxResidentRuntimes,
    hasResident,
  };
}
