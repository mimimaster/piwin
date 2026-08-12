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
  type SessionRuntimeEvictionReason,
  type SessionRuntimeResidency,
  type SessionRuntimeRetentionConfig,
} from '@piwin/contracts';

/** Residency state for one resident session (non-cold). */
export type ResidentRuntimeState = Exclude<SessionRuntimeResidency, 'cold'>;

/** Per-session residency bookkeeping. */
export type ResidentRuntimeEntry = {
  sessionId: string;
  runtimeGenerationId: string;
  state: ResidentRuntimeState;
  /** Monotonic clock time of the most recent touch/transition (ms). */
  lastUsedAtMs: number;
  /** Absolute deadline (ms) for an idle runtime; undefined while busy. */
  idleDeadlineMs?: number;
  /** Count of explicit protection leases (compaction, backend ops). */
  protectionCount: number;
  /** Last eviction/suspension reason, retained only while resident. */
  lastEvictionReason?: SessionRuntimeEvictionReason;
};

/** Aggregate memory sample for admission. */
export type ResidencyMemorySample = {
  /** Host process RSS in MiB. */
  hostRssMiB: number;
  /** Aggregate worker RSS in MiB; undefined when no workers are running. */
  workerRssMiB?: number;
  /** True when every expected worker sample is fresh. */
  sampleCompleteness: 'complete' | 'partial' | 'missing';
};

/** Counts of a runtime by residency state (for metrics/doctor). */
export type ResidencyCounts = {
  resident: number;
  activating: number;
  residentIdle: number;
  residentBusy: number;
  suspending: number;
  waiterCount: number;
};

/** Bounded aggregate eviction/failure counters. */
export type ResidencyCounters = {
  evictedByIdleTtl: number;
  evictedByMaxIdle: number;
  evictedByMaxResident: number;
  evictedByMemoryPressure: number;
  memoryPressureFailures: number;
};

export type ResidencyControllerOptions = {
  /** Normalized retention policy (ADR 0040 §3). */
  retention: SessionRuntimeRetentionConfig;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  nowMs?: () => number;
  /** Samples aggregate Host/worker RSS for admission. Omit to disable RSS pressure. */
  sampleMemory?: () => ResidencyMemorySample;
  /**
   * Resolve the effective maximum resident runtimes. When omitted the
   * controller derives it from the retention config plus idle allowance,
   * clamped to the backend hard cap and the absolute ceiling.
   */
  resolveMaxResidentRuntimes?: () => number;
  /** Sweep interval (ms). Defaults to 30s. Only runs while a runtime is resident. */
  sweepIntervalMs?: number;
  /** Callback for residency status changes (push emission). */
  onResidencyChanged?: (entry: ResidentRuntimeEntry) => void;
  /**
   * Host-provided blocker predicate (ADR 0040 §5). Return true when a session
   * must never be evicted: an active/cancelling Run, a pending permission or
   * Extension UI request, an in-flight compaction or replacement, or any
   * transition already in progress. The controller never evicts such a
   * runtime, so admission prefers waiting over killing busy work.
   */
  isRuntimeProtected?: (sessionId: string) => boolean;
  /**
   * Performs the Host-owned suspension transaction while the entry remains in
   * `suspending`. Return true only after recorder flush, backend drop, and
   * resident-map cleanup have completed. Returning false restores residency.
   */
  suspendRuntime?: (input: {
    sessionId: string;
    runtimeGenerationId: string;
    reason: SessionRuntimeEvictionReason;
  }) => Promise<boolean>;
  /**
   * Fires on every periodic sweep while at least one runtime is resident
   * (default every 30s). Used by the Host to refresh cross-process runtime
   * lease heartbeats so a long-idle resident session never looks abandoned.
   */
  onSweep?: () => void;
};

/** A FIFO waiter blocked on capacity. */
type CapacityWaiter = {
  sessionId: string;
  runtimeGenerationId: string;
  signal: AbortSignal;
  /** Resolves once capacity is granted and the activation is admitted. */
  promise: Promise<ActivationResult>;
  resolve: () => void;
  reject: (error: Error) => void;
  onAbort: () => void;
};

type SuspensionWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

/** Public controller surface. */
export type SessionRuntimeResidencyController = {
  /** Residency state for one session, or 'cold' when not resident. */
  getResidency: (sessionId: string) => SessionRuntimeResidency;
  /** Full resident entry snapshot for status composition. */
  getEntry: (sessionId: string) => ResidentRuntimeEntry | undefined;
  /** Touch (mark recently used) an existing resident runtime. */
  touch: (sessionId: string, runtimeGenerationId: string) => void;
  /** Apply a newly persisted normalized retention policy. */
  updateRetention: (retention: SessionRuntimeRetentionConfig) => void;
  /**
   * Begin an activation. Resolves when capacity is reserved (may wait for an
   * eviction or a busy runtime to finish). Rejects on abort or memory pressure.
   */
  beginActivation: (
    sessionId: string,
    runtimeGenerationId: string,
    signal: AbortSignal,
  ) => Promise<ActivationResult>;
  /** Commit a successfully created generation (activating -> resident-idle). */
  commitActivation: (sessionId: string, runtimeGenerationId: string) => void;
  /** Abort a failed activation and release its reservation. */
  abortActivation: (sessionId: string, runtimeGenerationId: string) => void;
  /** Mark a runtime busy (protected operation in flight). */
  markBusy: (sessionId: string, runtimeGenerationId: string) => void;
  /** Mark a runtime idle again (protected operation finished). */
  markIdle: (sessionId: string, runtimeGenerationId: string) => void;
  /** Acquire an explicit protection lease (compaction/backend op). */
  protect: (sessionId: string, runtimeGenerationId: string) => boolean;
  /** Release one protection lease. */
  releaseProtection: (sessionId: string, runtimeGenerationId: string) => void;
  /** Whether a session holds an explicit protection lease or is busy. */
  isProtected: (sessionId: string) => boolean;
  /**
   * Suspension transaction. Returns 'started' when the runtime is marked
   * `suspending` and the caller must run cleanup, then call `finishSuspend`.
   */
  beginSuspend: (
    sessionId: string,
    runtimeGenerationId: string,
    reason: SessionRuntimeEvictionReason,
  ) => SuspendResult;
  /** Complete a suspension and release the residency entry. */
  finishSuspend: (sessionId: string, runtimeGenerationId: string) => void;
  /**
   * Restore a `suspending` runtime to `resident-idle` when Host cleanup fails
   * (recorder flush error) so the runtime stays resident (ADR 0040 §6).
   */
  abortSuspend: (sessionId: string, runtimeGenerationId: string) => boolean;
  /** Run and deduplicate the complete Host suspension transaction. */
  requestSuspend: (
    sessionId: string,
    runtimeGenerationId: string,
    reason: SessionRuntimeEvictionReason,
  ) => Promise<boolean>;
  /** Force an eviction sweep now (tests and host dispose). */
  sweepNow: () => Promise<void>;
  /** Stop the sweep timer and clear all state. */
  dispose: () => void;
  /** Aggregate counts for metrics/doctor. */
  getCounts: () => ResidencyCounts;
  /** Aggregate eviction/failure counters. */
  getCounters: () => ResidencyCounters;
  /** Effective resident-runtime ceiling after adaptive/default resolution. */
  getMaxResidentRuntimes: () => number;
  /** Whether at least one runtime is resident. */
  hasResident: () => boolean;
};

export type ActivationResult =
  { ok: true } | { ok: false; code: 'aborted' | 'memory-pressure'; message: string };

export type SuspendResult =
  | { ok: true; status: 'started' }
  | { ok: false; reason: 'not-resident' | 'generation-mismatch' | 'protected' };

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
    // Adaptive default: effective concurrency (assumed at least 1) plus the
    // idle allowance, clamped to the absolute ceiling of 8.
    return Math.min(1 + maxIdleRuntimes, ABSOLUTE_MAX_RESIDENT_RUNTIMES);
  }

  function makeEntry(
    sessionId: string,
    runtimeGenerationId: string,
    state: ResidentRuntimeState,
  ): ResidentRuntimeEntry {
    const now = nowMs();
    return {
      sessionId,
      runtimeGenerationId,
      state,
      lastUsedAtMs: now,
      protectionCount: 0,
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

  /** Highest-priority idle victim candidates. Never includes protected runtimes. */
  function collectIdleVictims(): ResidentRuntimeEntry[] {
    return [...entries.values()]
      .filter(
        (entry) =>
          entry.state === 'resident-idle' &&
          entry.protectionCount === 0 &&
          options.isRuntimeProtected?.(entry.sessionId) !== true,
      )
      .sort((left, right) => {
        // Expired idle first, then least-recently-used; tie-break by stable id.
        const leftExpired = left.idleDeadlineMs !== undefined && left.idleDeadlineMs <= nowMs();
        const rightExpired = right.idleDeadlineMs !== undefined && right.idleDeadlineMs <= nowMs();
        if (leftExpired !== rightExpired) return leftExpired ? -1 : 1;
        if (left.lastUsedAtMs !== right.lastUsedAtMs) {
          return left.lastUsedAtMs - right.lastUsedAtMs;
        }
        return left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0;
      });
  }

  function aggregateRssMiB(): number | undefined {
    if (!sampleMemory) return undefined;
    const sample = sampleMemory();
    if (sample.sampleCompleteness !== 'complete') return undefined;
    return sample.hostRssMiB + (sample.workerRssMiB ?? 0);
  }

  function effectiveMemoryBudgetMiB():
    | {
        highWaterMiB: number;
        lowWaterMiB: number;
      }
    | undefined {
    if (retention.memoryHighWaterMiB === undefined) return undefined;
    const highWaterMiB = retention.memoryHighWaterMiB;
    return { highWaterMiB, lowWaterMiB: Math.round(highWaterMiB * 0.8) };
  }

  /** Suspend idle victims in LRU order until count and memory are under target. */
  async function evictIdleForAdmission(): Promise<void> {
    const maxResident = resolveMaxResidentRuntimes();
    const memoryBudget = effectiveMemoryBudgetMiB();

    for (const victim of collectIdleVictims()) {
      const countUnder = entries.size < maxResident;
      const idleOver = idleCount() > maxIdleRuntimes;
      const rssMiB = aggregateRssMiB();
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
      await requestSuspend(victim.sessionId, victim.runtimeGenerationId, reason);
    }
  }

  function idleCount(): number {
    let count = 0;
    for (const entry of entries.values()) {
      if (entry.state === 'resident-idle') count += 1;
    }
    return count;
  }

  function grantWaiters(): void {
    const maxResident = resolveMaxResidentRuntimes();
    for (const [sessionId, waiter] of [...waiters]) {
      if (disposed) break;
      if (entries.size >= maxResident) break;
      if (waiter.signal.aborted) {
        waiters.delete(sessionId);
        continue;
      }
      waiters.delete(sessionId);
      waiter.signal.removeEventListener('abort', waiter.onAbort);
      // Reserve capacity: the activation is now admitted.
      const reservation = makeEntry(sessionId, waiter.runtimeGenerationId, 'activating');
      entries.set(sessionId, reservation);
      publish(reservation);
      startSweepTimerIfNeeded();
      waiter.resolve();
    }
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
  ): Promise<ActivationResult> {
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
          await waitForSuspension(sessionId, runtimeGenerationId, signal);
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
    await evictIdleForAdmission();
    if (disposed) {
      throw new Error('host-disposed');
    }
    if (signal.aborted) {
      throw Object.assign(new Error('aborted'), { code: 'aborted' });
    }

    // Memory-pressure gate: fail the activation when idle eviction cannot
    // bring aggregate RSS below the high-water mark.
    const memoryBudget = effectiveMemoryBudgetMiB();
    const rssMiB = aggregateRssMiB();
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
      const reservation = makeEntry(sessionId, runtimeGenerationId, 'activating');
      entries.set(sessionId, reservation);
      publish(reservation);
      startSweepTimerIfNeeded();
      return Promise.resolve({ ok: true });
    }

    // All capacity is occupied by non-idle runtimes: queue a FIFO waiter.
    return queueCapacityWaiter(sessionId, runtimeGenerationId, signal);
  }

  /** Queue a cancellable FIFO capacity waiter and return its promise. */
  function queueCapacityWaiter(
    sessionId: string,
    runtimeGenerationId: string,
    signal: AbortSignal,
  ): Promise<ActivationResult> {
    let resolveActivation: (result: ActivationResult) => void = () => {
      throw new Error('capacity waiter was not initialized');
    };
    let rejectActivation: (error: Error) => void = () => {
      throw new Error('capacity waiter was not initialized');
    };
    const promise = new Promise<ActivationResult>((resolve, reject) => {
      resolveActivation = resolve;
      rejectActivation = reject;
    });
    const onAbort = () => {
      if (waiters.get(sessionId)) {
        waiters.delete(sessionId);
        signal.removeEventListener('abort', onAbort);
        rejectActivation(Object.assign(new Error('aborted'), { code: 'aborted' }));
      }
    };
    const waiter: CapacityWaiter = {
      sessionId,
      runtimeGenerationId,
      signal,
      promise,
      resolve: () => resolveActivation({ ok: true }),
      reject: rejectActivation,
      onAbort,
    };
    waiters.set(sessionId, waiter);
    signal.addEventListener('abort', onAbort, { once: true });
    return promise;
  }

  /** Wait for a same-generation suspension to finish before reactivating. */
  function waitForSuspension(
    sessionId: string,
    runtimeGenerationId: string,
    signal: AbortSignal,
  ): Promise<ActivationResult> {
    return new Promise<ActivationResult>((resolve, reject) => {
      let waiter: SuspensionWaiter | undefined;
      const onAbort = () => {
        if (waiter) {
          const currentWaiters = suspensionWaiters.get(sessionId);
          const remainingWaiters = currentWaiters?.filter((candidate) => candidate !== waiter);
          if (remainingWaiters && remainingWaiters.length > 0) {
            suspensionWaiters.set(sessionId, remainingWaiters);
          } else {
            suspensionWaiters.delete(sessionId);
          }
        }
        reject(Object.assign(new Error('aborted'), { code: 'aborted' }));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      const waitersList = suspensionWaiters.get(sessionId) ?? [];
      waiter = {
        resolve: () => {
          signal.removeEventListener('abort', onAbort);
          resolve({ ok: true });
        },
        reject: (error: Error) => {
          signal.removeEventListener('abort', onAbort);
          reject(error);
        },
      };
      waitersList.push(waiter);
      suspensionWaiters.set(sessionId, waitersList);
    });
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
    entry.state = 'resident-idle';
    entry.lastUsedAtMs = nowMs();
    entry.idleDeadlineMs = idleTtlMs > 0 ? entry.lastUsedAtMs + idleTtlMs : entry.lastUsedAtMs;
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
    if (entry.state === 'resident-busy') {
      entry.state = 'resident-idle';
    }
    entry.lastUsedAtMs = nowMs();
    entry.idleDeadlineMs = idleTtlMs > 0 ? entry.lastUsedAtMs + idleTtlMs : entry.lastUsedAtMs;
    publish(entry);
    // A newly idle runtime is the immediate LRU candidate for queued work.
    void evictIdleForAdmission().then(() => grantWaiters());
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
      void evictIdleForAdmission().then(() => grantWaiters());
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
    const entry = entries.get(sessionId);
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
    publish(entry);
    return { ok: true, status: 'started' };
  }

  function finishSuspend(sessionId: string, runtimeGenerationId: string): void {
    const entry = entries.get(sessionId);
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
        counters.evictedByIdleTtl += 1;
        break;
      case 'max-idle':
        counters.evictedByMaxIdle += 1;
        break;
      case 'max-resident':
        counters.evictedByMaxResident += 1;
        break;
      case 'memory-pressure':
        counters.evictedByMemoryPressure += 1;
        break;
      default:
        break;
    }
    entries.delete(sessionId);
    stopSweepTimerIfIdle();
    const suspensionResolvers = suspensionWaiters.get(sessionId);
    if (suspensionResolvers) {
      suspensionWaiters.delete(sessionId);
      for (const resolver of suspensionResolvers) {
        resolver.resolve();
      }
    }
    grantWaiters();
  }

  /**
   * Restore a `suspending` runtime to `resident-idle` when the Host cleanup
   * transaction fails (e.g. recorder flush failed) so the runtime stays
   * resident instead of leaking detached state (ADR 0040 §6).
   */
  function abortSuspend(sessionId: string, runtimeGenerationId: string): boolean {
    const entry = entries.get(sessionId);
    if (
      !entry ||
      entry.state !== 'suspending' ||
      entry.runtimeGenerationId !== runtimeGenerationId
    ) {
      return false;
    }
    entry.state = 'resident-idle';
    entry.lastUsedAtMs = nowMs();
    entry.idleDeadlineMs = idleTtlMs > 0 ? entry.lastUsedAtMs + idleTtlMs : entry.lastUsedAtMs;
    publish(entry);
    const suspensionResolvers = suspensionWaiters.get(sessionId);
    if (suspensionResolvers) {
      suspensionWaiters.delete(sessionId);
      for (const resolver of suspensionResolvers) {
        resolver.reject(new Error('runtime suspension aborted'));
      }
    }
    return true;
  }

  function requestSuspend(
    sessionId: string,
    runtimeGenerationId: string,
    reason: SessionRuntimeEvictionReason,
  ): Promise<boolean> {
    const existingTransition = suspensionTransitions.get(sessionId);
    if (existingTransition) {
      if (existingTransition.runtimeGenerationId === runtimeGenerationId) {
        return existingTransition.promise;
      }
      return Promise.resolve(false);
    }
    const started = beginSuspend(sessionId, runtimeGenerationId, reason);
    if (!started.ok) {
      return Promise.resolve(false);
    }
    const transition = (async () => {
      let suspended = true;
      try {
        suspended =
          (await options.suspendRuntime?.({ sessionId, runtimeGenerationId, reason })) ?? true;
      } catch {
        suspended = false;
      }
      if (suspended) {
        finishSuspend(sessionId, runtimeGenerationId);
        return true;
      }
      abortSuspend(sessionId, runtimeGenerationId);
      return false;
    })().finally(() => {
      const current = suspensionTransitions.get(sessionId);
      if (current?.promise === transition) {
        suspensionTransitions.delete(sessionId);
      }
    });
    suspensionTransitions.set(sessionId, { runtimeGenerationId, promise: transition });
    return transition;
  }

  async function sweepNow(): Promise<void> {
    if (disposed) return;
    options.onSweep?.();
    // Expired idle first (TTL), then capacity/idle/memory pressure. A runtime
    // blocked by Host work (active Run, pending permission/UI, compaction,
    // replacement, transition) is never an eviction victim.
    const now = nowMs();
    for (const entry of [...entries.values()]) {
      if (entry.state !== 'resident-idle' || entry.protectionCount > 0) continue;
      if (options.isRuntimeProtected?.(entry.sessionId) === true) continue;
      if (entry.idleDeadlineMs !== undefined && entry.idleDeadlineMs <= now) {
        await requestSuspend(entry.sessionId, entry.runtimeGenerationId, 'idle-ttl');
      }
    }
    await evictIdleForAdmission();
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
    for (const entry of entries.values()) {
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
    dispose,
    getCounts,
    getCounters,
    getMaxResidentRuntimes,
    hasResident,
  };
}
