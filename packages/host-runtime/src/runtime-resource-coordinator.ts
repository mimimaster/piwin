/**
 * Execution admission controller.
 *
 * Hands out leaf-run leases (`session-turn` / `subagent-task`). Session
 * create, parent plan/batch Runs, idle Runtime residency, and Worker
 * processes are not counted here.
 *
 * Capacity comes from product `execution.maxConcurrentRuns` and an optional
 * tighter resident-runtime limit. It never reads Worker Supervisor size,
 * CPU parallelism, or `processIsolation`.
 *
 * Leases release exactly once. Cancelling a queued Run aborts its wait
 * without consuming a slot.
 */

import type { ExecutionLimitingReason, ExecutionResourceStatus } from '@piwin/contracts';
import { DEFAULT_MAX_CONCURRENT_RUNS } from '@piwin/contracts';

export type ExecutionClass = 'foreground' | 'subagent';

export type ExecutionAdmissionRequest = {
  runId: string;
  executionClass: ExecutionClass;
  signal: AbortSignal;
  onQueued?: () => void;
};

/** A lease on an agent execution slot. */
export type ResourceLease = {
  resourceKind: 'agent-execution';
  runId: string;
  executionClass: ExecutionClass;
  acquiredAt: string;
};

/** Combined status view for UI/CLI reporting. */
export type ResourceCoordinatorStatus = ExecutionResourceStatus & {
  /** Reported for diagnostics; never used to clamp foreground concurrency. */
  processIsolation: boolean;
  /** @deprecated use configuredMaxConcurrentRuns */
  configuredMaxConcurrency: number;
  /** @deprecated use effectiveMaxConcurrentRuns */
  effectiveMaxConcurrency: number;
  /** @deprecated use activeRuns */
  activeLeases: number;
};

export type RuntimeResourceCoordinatorOptions = {
  configuredMaxConcurrentRuns: number;
  subagentMaxConcurrency: number;
  /** Optional tighter cap from explicit runtime residency. */
  residentRuntimeLimit?: number;
  processIsolation?: boolean;
  now?: () => Date;
};

export type RuntimeResourceCoordinator = {
  acquire(request: ExecutionAdmissionRequest): Promise<ResourceLease>;
  release(lease: ResourceLease): void;
  getStatus(): ResourceCoordinatorStatus;
  setProcessIsolation(isolated: boolean): void;
  setConfiguredMaxConcurrentRuns(max: number): void;
  setSubagentMaxConcurrency(max: number): void;
  setResidentRuntimeLimit(limit: number | undefined): void;
  /** @deprecated use setConfiguredMaxConcurrentRuns */
  setConfiguredMaxConcurrency(max: number): void;
};

type Waiter = {
  runId: string;
  executionClass: ExecutionClass;
  resolve: (lease: ResourceLease) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

export function createRuntimeResourceCoordinator(
  options: RuntimeResourceCoordinatorOptions,
): RuntimeResourceCoordinator {
  const now = options.now ?? (() => new Date());

  let configuredMaxConcurrentRuns = clampPositive(
    options.configuredMaxConcurrentRuns,
    DEFAULT_MAX_CONCURRENT_RUNS,
  );
  let subagentMaxConcurrency = clampPositive(options.subagentMaxConcurrency, 4);
  let residentRuntimeLimit = options.residentRuntimeLimit;
  let processIsolation = options.processIsolation ?? true;

  const activeLeases = new Map<string, ResourceLease>();
  const waiters = new Map<string, Waiter>();

  function computeEffectiveMax(): number {
    const configured = Math.min(configuredMaxConcurrentRuns, DEFAULT_MAX_CONCURRENT_RUNS);
    if (residentRuntimeLimit === undefined) {
      return configured;
    }
    return Math.min(configured, Math.max(1, residentRuntimeLimit));
  }

  function currentLimitingReason(): ExecutionLimitingReason {
    if (residentRuntimeLimit !== undefined && residentRuntimeLimit < configuredMaxConcurrentRuns) {
      return 'runtime-residency';
    }
    return 'execution-config';
  }

  function countActive(executionClass: ExecutionClass): number {
    let count = 0;
    for (const lease of activeLeases.values()) {
      if (lease.executionClass === executionClass) {
        count += 1;
      }
    }
    return count;
  }

  function countWaiting(executionClass: ExecutionClass): number {
    let count = 0;
    for (const waiter of waiters.values()) {
      if (waiter.executionClass === executionClass) {
        count += 1;
      }
    }
    return count;
  }

  function canAdmit(executionClass: ExecutionClass): boolean {
    if (activeLeases.size >= computeEffectiveMax()) {
      return false;
    }
    if (executionClass === 'subagent' && countActive('subagent') >= subagentMaxConcurrency) {
      return false;
    }
    return true;
  }

  function grant(runId: string, executionClass: ExecutionClass): ResourceLease {
    const lease: ResourceLease = {
      resourceKind: 'agent-execution',
      runId,
      executionClass,
      acquiredAt: now().toISOString(),
    };
    activeLeases.set(runId, lease);
    return lease;
  }

  /** Grant every currently eligible waiter. Foreground FIFO beats subagent FIFO. */
  function tryGrantWaiters(): void {
    let granted = true;
    while (granted) {
      granted = false;
      for (const executionClass of ['foreground', 'subagent'] as const) {
        for (const [waiterRunId, waiter] of waiters) {
          if (waiter.executionClass !== executionClass) {
            continue;
          }
          if (waiter.signal.aborted) {
            waiters.delete(waiterRunId);
            waiter.signal.removeEventListener('abort', waiter.onAbort);
            waiter.reject(new Error('aborted'));
            continue;
          }
          if (!canAdmit(waiter.executionClass)) {
            continue;
          }
          waiters.delete(waiterRunId);
          waiter.signal.removeEventListener('abort', waiter.onAbort);
          waiter.resolve(grant(waiterRunId, waiter.executionClass));
          granted = true;
          break;
        }
        if (granted) {
          break;
        }
      }
    }
  }

  function acquire(request: ExecutionAdmissionRequest): Promise<ResourceLease> {
    const { runId, executionClass, signal, onQueued } = request;
    if (signal.aborted) {
      return Promise.reject(new Error('aborted'));
    }
    const existing = activeLeases.get(runId);
    if (existing) {
      return Promise.resolve(existing);
    }
    if (canAdmit(executionClass)) {
      return Promise.resolve(grant(runId, executionClass));
    }

    onQueued?.();
    return new Promise<ResourceLease>((resolve, reject) => {
      const onAbort = (): void => {
        const removed = waiters.get(runId);
        if (removed) {
          waiters.delete(runId);
          reject(new Error('aborted'));
        }
      };
      waiters.set(runId, {
        runId,
        executionClass,
        resolve,
        reject,
        signal,
        onAbort,
      });
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function release(lease: ResourceLease): void {
    const existing = activeLeases.get(lease.runId);
    if (!existing) {
      return;
    }
    activeLeases.delete(lease.runId);
    tryGrantWaiters();
  }

  function getStatus(): ResourceCoordinatorStatus {
    const configured = configuredMaxConcurrentRuns;
    const effective = computeEffectiveMax();
    const activeForegroundRuns = countActive('foreground');
    const activeSubagentRuns = countActive('subagent');
    const waitingForegroundRuns = countWaiting('foreground');
    const waitingSubagentRuns = countWaiting('subagent');
    const status: ResourceCoordinatorStatus = {
      configuredMaxConcurrentRuns: configured,
      effectiveMaxConcurrentRuns: effective,
      activeRuns: activeLeases.size,
      waitingRuns: waiters.size,
      activeForegroundRuns,
      waitingForegroundRuns,
      activeSubagentRuns,
      waitingSubagentRuns,
      subagentMaxConcurrency,
      limitingReason: currentLimitingReason(),
      processIsolation,
      configuredMaxConcurrency: configured,
      effectiveMaxConcurrency: effective,
      activeLeases: activeLeases.size,
    };
    return status;
  }

  function setProcessIsolation(isolated: boolean): void {
    processIsolation = isolated;
    tryGrantWaiters();
  }

  function setConfiguredMaxConcurrentRuns(max: number): void {
    configuredMaxConcurrentRuns = clampPositive(max, DEFAULT_MAX_CONCURRENT_RUNS);
    tryGrantWaiters();
  }

  function setSubagentMaxConcurrency(max: number): void {
    subagentMaxConcurrency = clampPositive(max, 4);
    tryGrantWaiters();
  }

  function setResidentRuntimeLimit(limit: number | undefined): void {
    residentRuntimeLimit = limit;
    tryGrantWaiters();
  }

  return {
    acquire,
    release,
    getStatus,
    setProcessIsolation,
    setConfiguredMaxConcurrentRuns,
    setSubagentMaxConcurrency,
    setResidentRuntimeLimit,
    setConfiguredMaxConcurrency: setConfiguredMaxConcurrentRuns,
  };
}

function clampPositive(value: number, ceiling: number): number {
  if (!Number.isFinite(value)) {
    return ceiling;
  }
  return Math.max(1, Math.min(ceiling, Math.floor(value)));
}
