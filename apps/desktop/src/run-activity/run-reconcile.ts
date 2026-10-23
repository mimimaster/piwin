import type { ExecutionRunRecord } from '@piwin/contracts';
import { isRunTerminal } from '@piwin/contracts';

/** How the UI should reconcile a locally-live run against Host authority. */
export type RunReconcileDecision =
  /** Host has a terminal record: apply it as the authoritative terminal. */
  | 'apply-terminal'
  /** Host has no foreground run at all: the local streaming state is stale. */
  | 'clear-stale'
  /** Host still reports an active run (or the query gave no usable answer). */
  | 'none';

/**
 * ADR 0038 reconciliation policy for a client that suspects lost pushes
 * (sequence gap, refocus after a long stall). The query result is the only
 * input: `undefined` means the query failed or the Host is legacy and cannot
 * answer, in which case reconciling would be guessing — do nothing.
 */
export function planRunReconcile(
  hostRun: ExecutionRunRecord | null | undefined,
): RunReconcileDecision {
  if (hostRun === undefined) {
    return 'none';
  }
  if (hostRun === null) {
    return 'clear-stale';
  }
  return isRunTerminal(hostRun.status) ? 'apply-terminal' : 'none';
}
