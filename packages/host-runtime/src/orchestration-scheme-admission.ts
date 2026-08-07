/**
 * ORCH: turn-scoped subagent admission for an active orchestration scheme.
 *
 * Spec §8.4: scheme maxConcurrency / maxTasksPerRun apply only to subagent
 * batches started by the parent prompt run. They do not rewrite Settings.
 *
 * Model-facing `piwin_subagent_run` is one task per call; the main agent may
 * still issue multiple calls in one turn. This gate counts those calls per
 * parent runId so Ultra Code ceilings are real, not resolve-only dead data.
 */

export type SchemeAdmissionLimits = {
  maxConcurrency: number;
  maxTasksPerRun: number;
};

export type SchemeAdmissionSnapshot = {
  activeCount: number;
  startedCount: number;
  maxConcurrency: number;
  maxTasksPerRun: number;
};

export type SchemeAdmissionDecision =
  | { kind: 'admit' }
  | { kind: 'wait' }
  | { kind: 'reject'; reason: string };

/** Pure decision used by the gate and unit tests. */
export function decideSchemeAdmission(
  limits: SchemeAdmissionLimits | undefined,
  state: { activeCount: number; startedCount: number },
): SchemeAdmissionDecision {
  if (!limits) {
    return { kind: 'admit' };
  }
  const maxConcurrency = Math.max(1, limits.maxConcurrency);
  const maxTasksPerRun = Math.max(1, limits.maxTasksPerRun);
  if (state.startedCount >= maxTasksPerRun) {
    return {
      kind: 'reject',
      reason: `orchestration scheme maxTasksPerRun (${maxTasksPerRun}) reached for this turn`,
    };
  }
  if (state.activeCount >= maxConcurrency) {
    return { kind: 'wait' };
  }
  return { kind: 'admit' };
}

type TurnAdmissionEntry = {
  limits: SchemeAdmissionLimits;
  activeCount: number;
  startedCount: number;
  waiters: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }>;
};

/**
 * In-memory admission controller keyed by parent prompt runId.
 * Bind limits when the scheme is resolved; clear on run terminate.
 */
export class TurnScopedSchemeAdmissionGate {
  private readonly entries = new Map<string, TurnAdmissionEntry>();

  /** Bind (or replace) scheme ceilings for a parent run. */
  bind(parentRunId: string, limits: SchemeAdmissionLimits): void {
    const existing = this.entries.get(parentRunId);
    if (existing) {
      existing.limits = {
        maxConcurrency: Math.max(1, limits.maxConcurrency),
        maxTasksPerRun: Math.max(1, limits.maxTasksPerRun),
      };
      this.wakeWaiters(parentRunId);
      return;
    }
    this.entries.set(parentRunId, {
      limits: {
        maxConcurrency: Math.max(1, limits.maxConcurrency),
        maxTasksPerRun: Math.max(1, limits.maxTasksPerRun),
      },
      activeCount: 0,
      startedCount: 0,
      waiters: [],
    });
  }

  /** Drop binding and reject any queued waiters (run ended). */
  clear(parentRunId: string): void {
    const entry = this.entries.get(parentRunId);
    if (!entry) return;
    this.entries.delete(parentRunId);
    const waiters = entry.waiters.splice(0, entry.waiters.length);
    for (const waiter of waiters) {
      waiter.reject(new Error('orchestration scheme admission cleared: parent run ended'));
    }
  }

  getSnapshot(parentRunId: string): SchemeAdmissionSnapshot | undefined {
    const entry = this.entries.get(parentRunId);
    if (!entry) return undefined;
    return {
      activeCount: entry.activeCount,
      startedCount: entry.startedCount,
      maxConcurrency: entry.limits.maxConcurrency,
      maxTasksPerRun: entry.limits.maxTasksPerRun,
    };
  }

  /**
   * Reserve one subagent slot for this parent run.
   * Waits when at concurrency ceiling; rejects when tasks-per-run is exhausted.
   * Caller must always invoke the returned release (typically in `finally`).
   */
  async acquire(
    parentRunId: string | undefined,
    signal?: AbortSignal,
  ): Promise<{ release: () => void } | undefined> {
    if (!parentRunId) {
      return undefined;
    }
    const entry = this.entries.get(parentRunId);
    if (!entry) {
      // No scheme bound → zero scheme admission work (ORCH-G3).
      return undefined;
    }

    for (;;) {
      if (signal?.aborted) {
        throw new Error('aborted while waiting for orchestration scheme admission');
      }

      const decision = decideSchemeAdmission(entry.limits, {
        activeCount: entry.activeCount,
        startedCount: entry.startedCount,
      });

      if (decision.kind === 'reject') {
        throw new Error(decision.reason);
      }

      if (decision.kind === 'admit') {
        entry.activeCount += 1;
        entry.startedCount += 1;
        let released = false;
        return {
          release: (): void => {
            if (released) return;
            released = true;
            const current = this.entries.get(parentRunId);
            if (!current) return;
            current.activeCount = Math.max(0, current.activeCount - 1);
            this.wakeWaiters(parentRunId);
          },
        };
      }

      // Concurrently at the ceiling: wait for a release or abort.
      await new Promise<void>((resolve, reject) => {
        const waiter = {
          resolve: (): void => {
            cleanup();
            resolve();
          },
          reject: (error: Error): void => {
            cleanup();
            reject(error);
          },
        };
        const onAbort = (): void => {
          const index = entry.waiters.indexOf(waiter);
          if (index >= 0) {
            entry.waiters.splice(index, 1);
          }
          cleanup();
          reject(new Error('aborted while waiting for orchestration scheme admission'));
        };
        const cleanup = (): void => {
          if (signal) {
            signal.removeEventListener('abort', onAbort);
          }
        };
        entry.waiters.push(waiter);
        if (signal) {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
  }

  private wakeWaiters(parentRunId: string): void {
    const entry = this.entries.get(parentRunId);
    if (!entry || entry.waiters.length === 0) return;
    // Wake one waiter at a time so concurrent acquirers re-check the budget.
    const nextWaiter = entry.waiters.shift();
    nextWaiter?.resolve();
  }
}
