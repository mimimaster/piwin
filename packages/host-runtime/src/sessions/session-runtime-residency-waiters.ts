/**
 * FIFO capacity waiters and same-generation suspension waiters for the
 * residency controller. Extracted so the controller factory can stay a
 * closure without owning waiter bookkeeping.
 */

import type { ActivationResult, ResidentRuntimeEntry } from './session-runtime-residency-types.js';

/** A FIFO waiter blocked on capacity. */
export type CapacityWaiter = {
  sessionId: string;
  runtimeGenerationId: string;
  signal: AbortSignal;
  /** Resolves once capacity is granted and the activation is admitted. */
  promise: Promise<ActivationResult>;
  resolve: () => void;
  reject: (error: Error) => void;
  onAbort: () => void;
  /** Preserved across the grant path so the admitted entry stays task-scoped. */
  ephemeral?: true;
};

export type SuspensionWaiter = {
  resolve: () => void;
  reject: (error: Error) => void;
};

/** Queue a cancellable FIFO capacity waiter and return its promise. */
export function queueCapacityWaiter(
  waiters: Map<string, CapacityWaiter>,
  sessionId: string,
  runtimeGenerationId: string,
  signal: AbortSignal,
  ephemeral?: boolean,
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
    ...(ephemeral === true ? { ephemeral: true as const } : {}),
  };
  waiters.set(sessionId, waiter);
  signal.addEventListener('abort', onAbort, { once: true });
  return promise;
}

/** Wait for a same-generation suspension to finish before reactivating. */
export function waitForSuspension(
  suspensionWaiters: Map<string, SuspensionWaiter[]>,
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

/** Admit queued capacity waiters while resident count is under the ceiling. */
export function grantCapacityWaiters(input: {
  isDisposed: () => boolean;
  waiters: Map<string, CapacityWaiter>;
  entries: Map<string, ResidentRuntimeEntry>;
  maxResident: number;
  admit: (waiter: CapacityWaiter) => void;
}): void {
  const { waiters, entries } = input;
  for (const [sessionId, waiter] of [...waiters]) {
    if (input.isDisposed()) break;
    if (entries.size >= input.maxResident) break;
    if (waiter.signal.aborted) {
      waiters.delete(sessionId);
      continue;
    }
    waiters.delete(sessionId);
    waiter.signal.removeEventListener('abort', waiter.onAbort);
    input.admit(waiter);
    waiter.resolve();
  }
}
