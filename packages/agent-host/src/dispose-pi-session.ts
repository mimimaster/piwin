/**
 * Graceful Pi session teardown helper.
 *
 * Mirrors upstream Pi's `AgentSessionRuntime.dispose()` sequence:
 * 1. Abort any in-flight turn on the underlying Pi session.
 * 2. Emit `session_shutdown` to registered extension handlers BEFORE calling
 *    `piSession.dispose()` (which invalidates `extensionRunner`).
 * 3. Dispose the underlying Pi session so listeners and session resources are
 *    released.
 *
 * Best-effort and bounded by a timeout so a hanging or throwing extension
 * shutdown hook can never wedge session eviction or host shutdown.
 */

export type PiSessionShutdownRunnerLike = {
  hasHandlers?: (eventType: string) => boolean;
  emit?: (event: { type: 'session_shutdown'; reason: 'quit' }) => Promise<unknown>;
};

export type DisposablePiSessionLike = {
  extensionRunner?: PiSessionShutdownRunnerLike;
  abort?: () => Promise<void>;
  dispose?: () => void | Promise<void>;
};

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 15_000;

export async function disposePiSession(
  piSession: DisposablePiSessionLike,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  try {
    await piSession.abort?.();
  } catch {
    // Best-effort: abort failures must not skip extension shutdown or dispose.
  }

  const runner = piSession.extensionRunner;
  if (
    runner &&
    typeof runner.emit === 'function' &&
    (typeof runner.hasHandlers !== 'function' || runner.hasHandlers('session_shutdown'))
  ) {
    const timeoutMs = options.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve(runner.emit({ type: 'session_shutdown', reason: 'quit' })),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
          timer.unref?.();
        }),
      ]);
    } catch {
      // Best-effort: an extension shutdown error must not prevent session dispose.
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  try {
    await piSession.dispose?.();
  } catch {
    // Best-effort cleanup.
  }
}
