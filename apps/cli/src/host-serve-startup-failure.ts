import { PiwinRootAlreadyOwnedError, PiwinRootOwnershipUnknownError } from '@piwin/host-runtime';

/**
 * Sidecar startup-failure protocol shared with Desktop
 * (`apps/desktop/src-tauri/src/host_bridge/exit_reason.rs`):
 *
 * - one stderr line `HOST_STARTUP_FATAL_PREFIX + message` carries the reason a
 *   user should see instead of "stdout closed";
 * - exit code `HOST_STARTUP_FATAL_EXIT_CODE` (EX_CONFIG) means respawning
 *   cannot help, so Desktop stops its restart schedule at once.
 */
export const HOST_STARTUP_FATAL_EXIT_CODE = 78;
export const HOST_STARTUP_FATAL_PREFIX = '[piwin-host:fatal] ';

/** Failures that fail the same way on every respawn until the user acts. */
export function isDeterministicStartupFailure(error: unknown): boolean {
  return (
    error instanceof PiwinRootAlreadyOwnedError || error instanceof PiwinRootOwnershipUnknownError
  );
}

/** One-line, user-facing reason for a startup failure. */
export function describeStartupFailure(error: unknown, rootDir: string): string {
  if (error instanceof PiwinRootAlreadyOwnedError) {
    return `${rootDir} is in use by another piwin process (pid ${error.owner.processId}). Quit that process, then reopen piwin.`;
  }
  if (error instanceof PiwinRootOwnershipUnknownError) {
    return `cannot verify who owns ${rootDir} (${error.message}). If no other piwin is running, remove ${rootDir}/.host/owner.lock and reopen piwin.`;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Reports a deterministic startup failure on stderr with the fatal marker and
 * sets the exit code; returns false (and reports nothing) for other errors,
 * which keep the ordinary crash path and Desktop's bounded restarts.
 */
export function reportDeterministicStartupFailure(error: unknown, rootDir: string): boolean {
  if (!isDeterministicStartupFailure(error)) return false;
  console.error(`${HOST_STARTUP_FATAL_PREFIX}${describeStartupFailure(error, rootDir)}`);
  process.exitCode = HOST_STARTUP_FATAL_EXIT_CODE;
  return true;
}
