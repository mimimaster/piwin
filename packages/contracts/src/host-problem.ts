import type { SessionRunPhase } from './host.js';

/**
 * Structured problem payload on failed HostResponse.
 * Complements the human-readable `error` string; does not replace it.
 */
export type HostProblem = {
  code: string;
  retryable?: boolean;
  data?: unknown;
};

export type ForegroundRunMismatchReason =
  | 'active'
  | 'changed'
  | 'already-finished'
  | 'transitioning';

/**
 * Typed problem when prompt foreground admission is refused because of an
 * existing or changing run. Assignable to HostProblem.
 */
export type ForegroundRunMismatchProblem = {
  code: 'foreground-run-mismatch';
  data: {
    reason: ForegroundRunMismatchReason;
    actualRun?: {
      runId: string;
      /** Remote Hosts project `{ runId }` only; status is stripped. */
      status?: 'queued' | 'running' | 'cancelling';
      phase?: SessionRunPhase;
    };
  };
};
