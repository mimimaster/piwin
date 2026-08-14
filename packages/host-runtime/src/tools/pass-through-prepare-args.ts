import type { HostToolArgumentPreparation, HostToolExecutionContext } from '@piwin/contracts';

/** Identity preparer for side-effect tools whose args are already canonical. */
export function passThroughPrepareArgs(
  rawArguments: Record<string, unknown>,
  _context: HostToolExecutionContext,
  signal: AbortSignal,
): HostToolArgumentPreparation {
  if (signal.aborted) {
    return {
      ok: false,
      result: { ok: false, code: 'aborted', message: 'tool preparation aborted' },
    };
  }
  return { ok: true, arguments: rawArguments };
}
