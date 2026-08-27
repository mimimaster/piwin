import type { AgentEvent, ExecutionRunRecord } from '@piwin/contracts';
import { isRunAbortReason } from './run-abort-reason.js';

export type ControlledAbortErrorContext = {
  signal?: AbortSignal;
  runStatus?: ExecutionRunRecord['status'];
  pauseRequested?: boolean;
};

/**
 * Once Host owns pause/stop, Agent error events are lifecycle noise.
 * Suppression is keyed off Host abort state, never error-message prose.
 */
export function shouldSuppressControlledAbortError(
  event: AgentEvent,
  context: ControlledAbortErrorContext = {},
): boolean {
  if (event.type !== 'error') {
    return false;
  }
  if (context.pauseRequested === true) {
    return true;
  }
  if (
    context.runStatus === 'cancelling' ||
    context.runStatus === 'cancelled' ||
    context.runStatus === 'interrupted'
  ) {
    return true;
  }
  return context.signal?.aborted === true && isRunAbortReason(context.signal.reason);
}
