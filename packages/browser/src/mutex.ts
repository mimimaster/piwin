/**
 * Promise-chain mutex ("browser bus"). All session operations (agent tool calls
 * and pick interactions) acquire one in-process lock so they never interleave
 * against a mid-navigation page (ADR 0020 §6).
 *
 * AbortSignal is observed at enqueue and again when this waiter actually starts.
 * Aborting a queued op skips its function; it does not cancel an in-flight
 * Playwright call (see PR1 abort evidence).
 */
import { AbortOperationError } from './browser-errors.js';

export type RunExclusive = <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
) => Promise<T>;

export type ExclusiveQueue = { runExclusive: RunExclusive };

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortOperationError('operation aborted');
}

export function createExclusiveQueue(): ExclusiveQueue {
  let tail: Promise<unknown> = Promise.resolve();

  function runExclusive<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(new AbortOperationError('operation aborted'));
    }
    const result = tail.then(() => {
      throwIfAborted(signal);
      return operation();
    });
    // Keep the chain alive even when an operation rejects, so a failure never
    // wedges the queue for subsequent callers.
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return { runExclusive };
}
