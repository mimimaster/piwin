/**
 * Lease in-flight executor promises past a client-visible timeout.
 */

export type ExecutionTracker = {
  track<T>(promise: Promise<T>): Promise<T>;
  pendingCount(): number;
  waitIdle(): Promise<void>;
};

export function createExecutionTracker(): ExecutionTracker {
  const pending = new Set<Promise<unknown>>();

  return {
    track<T>(promise: Promise<T>): Promise<T> {
      const leased: Promise<T> = promise.then(
        (value) => {
          pending.delete(leased);
          return value;
        },
        (error: unknown) => {
          pending.delete(leased);
          throw error;
        },
      );
      pending.add(leased);
      return leased;
    },

    pendingCount(): number {
      return pending.size;
    },

    async waitIdle(): Promise<void> {
      while (pending.size > 0) {
        await Promise.allSettled([...pending]);
      }
    },
  };
}
