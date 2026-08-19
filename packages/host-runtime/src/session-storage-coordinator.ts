/**
 * Per-session exclusive lock for cold-storage mutations.
 * Desktop may call HostRuntime without the CLI serialized lane.
 */
export type SessionStorageCoordinator = {
  withLock: <T>(sessionId: string, operation: () => Promise<T>) => Promise<T>;
};

export function createSessionStorageCoordinator(): SessionStorageCoordinator {
  const tails = new Map<string, Promise<unknown>>();

  return {
    async withLock(sessionId, operation) {
      const previous = tails.get(sessionId) ?? Promise.resolve();
      const run = previous.then(operation, operation);
      tails.set(
        sessionId,
        run.then(
          () => undefined,
          () => undefined,
        ),
      );
      return run;
    },
  };
}
