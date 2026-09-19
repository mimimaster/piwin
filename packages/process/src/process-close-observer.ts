import type { SupervisedProcess } from './process-supervisor.js';

export type ProcessCloseObserverInput = {
  supervised: SupervisedProcess;
  exitCode: number | null;
  finalize: (exitCode: number | null) => void;
  reportCleanupFailure: (error: unknown) => void;
};

/**
 * Defers Job terminalization until descendants owned by the supervisor have
 * drained. Older supervisor test doubles may not expose the optional cleanup.
 */
export function observeProcessClose(input: ProcessCloseObserverInput): void {
  const cleanup = input.supervised.cleanup;
  if (!cleanup) {
    input.finalize(input.exitCode);
    return;
  }

  void cleanup.then(
    () => input.finalize(input.exitCode),
    (error: unknown) => {
      input.reportCleanupFailure(error);
      input.finalize(input.exitCode);
    },
  );
}
