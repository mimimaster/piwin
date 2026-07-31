/**
 * Promise-chain mutex ("browser bus"). All session operations (agent tool calls
 * and pick interactions) acquire one in-process lock so they never interleave
 * against a mid-navigation page (ADR 0020 §6).
 */
export type RunExclusive = <T>(operation: () => Promise<T>) => Promise<T>;

export type ExclusiveQueue = { runExclusive: RunExclusive };

export function createExclusiveQueue(): ExclusiveQueue {
  let tail: Promise<unknown> = Promise.resolve();

  function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(() => operation());
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
