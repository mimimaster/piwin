/**
 * Process-wide settings/apply chain. Desktop has two get-then-apply writers
 * (workbench save queue and Settings `config/set` draft apply). A hook-local
 * queue cannot serialize them, so overlapping `desktop` replaces CAS-conflict
 * and toast "another client changed this page" during chat.
 */
export function createSettingsApplyChain(): {
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>;
  reset: () => void;
} {
  let tail: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  return {
    enqueue,
    reset: () => {
      tail = Promise.resolve();
    },
  };
}

const settingsApplyChain = createSettingsApplyChain();

export function enqueueSettingsApply<T>(operation: () => Promise<T>): Promise<T> {
  return settingsApplyChain.enqueue(operation);
}

export function resetSettingsApplyChainForTests(): void {
  settingsApplyChain.reset();
}
