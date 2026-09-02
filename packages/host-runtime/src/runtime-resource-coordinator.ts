/**
 * Runtime resource coordinator (runtime-refactor Phase 2, §3.8).
 *
 * Provides cancellation-aware acquisition of agent execution slots and a
 * combined status view (configured vs effective concurrency).
 *
 * SC-06: Product concurrency above one requires `processIsolation=true`.
 *   When process isolation is false, effective concurrency is clamped to 1.
 * SC-14: Resource owners count their own resources; the coordinator is not
 *   a second counter. The coordinator only tracks agent execution leases
 *   it has handed out — it does not duplicate Job, browser, or MCP counts.
 *
 * Leases release exactly once. Cancelling a queued Run aborts its lease
 * wait without consuming a slot.
 */

import { ABSOLUTE_MAX_RESIDENT_RUNTIMES } from '@piwin/contracts';

/** A lease on an agent execution slot. */
export type ResourceLease = {
  resourceKind: 'agent-execution';
  runId: string;
  acquiredAt: string;
};

/** Combined status view for UI/CLI reporting. */
export type ResourceCoordinatorStatus = {
  /** Effective subagent quota derived from PiwinConfig.subagents. */
  configuredMaxConcurrency: number;
  /** Effective concurrency (clamped to 1 when no process isolation). */
  effectiveMaxConcurrency: number;
  /** Currently acquired leases. */
  activeLeases: number;
  /** Subagent tasks waiting on quota. */
  waiterCount: number;
  /** Whether process isolation is available. */
  processIsolation: boolean;
};

/** Options for constructing a `RuntimeResourceCoordinator`. */
export type RuntimeResourceCoordinatorOptions = {
  /** Effective subagent quota derived from PiwinConfig.subagents. */
  configuredMaxConcurrency: number;
  /** Hard cap per batch. Default ABSOLUTE_MAX_RESIDENT_RUNTIMES. */
  hardCapPerBatch?: number;
  /** Whether the backend reports process isolation. */
  processIsolation: boolean;
  /** Inject clock for tests. */
  now?: () => Date;
};

/** Coordinator surface for acquiring and releasing agent execution slots. */
export type RuntimeResourceCoordinator = {
  /** Acquire an execution slot. Resolves when a slot is available. Aborts if signal fires. */
  acquire(runId: string, signal: AbortSignal): Promise<ResourceLease>;
  /** Release a lease (exactly once). */
  release(lease: ResourceLease): void;
  /** Get current status. */
  getStatus(): ResourceCoordinatorStatus;
  /** Update process isolation capability (when backend changes). */
  setProcessIsolation(isolated: boolean): void;
  /** Update configured max concurrency (when settings change). */
  setConfiguredMaxConcurrency(max: number): void;
};

/** Default hard cap per batch. */
const DEFAULT_HARD_CAP_PER_BATCH = ABSOLUTE_MAX_RESIDENT_RUNTIMES;

/**
 * Create a `RuntimeResourceCoordinator`.
 *
 * The coordinator tracks active agent-execution leases by runId. It does not
 * count Jobs, browser contexts, or MCP calls — those resource owners keep
 * their own counters (SC-14).
 */
export function createRuntimeResourceCoordinator(
  options: RuntimeResourceCoordinatorOptions,
): RuntimeResourceCoordinator {
  const hardCap = options.hardCapPerBatch ?? DEFAULT_HARD_CAP_PER_BATCH;
  const now = options.now ?? (() => new Date());

  let configuredMaxConcurrency = options.configuredMaxConcurrency;
  let processIsolation = options.processIsolation;

  /** Active leases keyed by runId. A runId may hold at most one lease. */
  const activeLeases = new Map<string, ResourceLease>();

  /** Waiters blocked on slot availability, keyed by runId. */
  const waiters = new Map<
    string,
    {
      resolve: (lease: ResourceLease) => void;
      reject: (error: Error) => void;
      signal: AbortSignal;
      onAbort: () => void;
    }
  >();

  function computeEffectiveMaxConcurrency(): number {
    return processIsolation
      ? Math.min(configuredMaxConcurrency, hardCap)
      : 1;
  }

  /**
   * Try to grant a pending waiter. Called after a release or capacity change.
   * Resolves the first waiter in insertion order if a slot is available.
   */
  function tryGrantWaiter(): void {
    if (activeLeases.size >= computeEffectiveMaxConcurrency()) return;

    for (const [waiterRunId, waiter] of waiters) {
      if (waiter.signal.aborted) {
        waiters.delete(waiterRunId);
        continue;
      }
      // Grant the slot.
      waiters.delete(waiterRunId);
      waiter.signal.removeEventListener('abort', waiter.onAbort);

      const lease: ResourceLease = {
        resourceKind: 'agent-execution',
        runId: waiterRunId,
        acquiredAt: now().toISOString(),
      };
      activeLeases.set(waiterRunId, lease);
      waiter.resolve(lease);
      return;
    }
  }

  function acquire(runId: string, signal: AbortSignal): Promise<ResourceLease> {
    // If already aborted, reject immediately without consuming a slot.
    if (signal.aborted) {
      return Promise.reject(new Error('aborted'));
    }

    // If a slot is available, grant immediately.
    if (activeLeases.size < computeEffectiveMaxConcurrency()) {
      const lease: ResourceLease = {
        resourceKind: 'agent-execution',
        runId,
        acquiredAt: now().toISOString(),
      };
      activeLeases.set(runId, lease);
      return Promise.resolve(lease);
    }

    // No slot available — queue the request.
    return new Promise<ResourceLease>((resolve, reject) => {
      const onAbort = (): void => {
        const removed = waiters.get(runId);
        if (removed) {
          waiters.delete(runId);
          reject(new Error('aborted'));
        }
      };

      waiters.set(runId, { resolve, reject, signal, onAbort });
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function release(lease: ResourceLease): void {
    // Idempotent: if the runId is not in activeLeases, this is a double
    // release (or the lease was never acquired) — no-op.
    const existing = activeLeases.get(lease.runId);
    if (!existing) return;

    activeLeases.delete(lease.runId);

    // Try to grant a waiting requester the freed slot.
    tryGrantWaiter();
  }

  function getStatus(): ResourceCoordinatorStatus {
    return {
      configuredMaxConcurrency,
      effectiveMaxConcurrency: computeEffectiveMaxConcurrency(),
      activeLeases: activeLeases.size,
      waiterCount: waiters.size,
      processIsolation,
    };
  }

  function setProcessIsolation(isolated: boolean): void {
    processIsolation = isolated;
    // If effective capacity increased, try to grant waiters.
    tryGrantWaiter();
  }

  function setConfiguredMaxConcurrency(max: number): void {
    configuredMaxConcurrency = max;
    // If effective capacity increased, try to grant waiters.
    tryGrantWaiter();
  }

  return {
    acquire,
    release,
    getStatus,
    setProcessIsolation,
    setConfiguredMaxConcurrency,
  };
}
