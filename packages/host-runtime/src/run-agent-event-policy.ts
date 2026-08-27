import type { AgentEvent, ExecutionRunRecord } from '@piwin/contracts';
import { isRunAbortReason } from './run-abort-reason.js';

export type ControlledAbortErrorContext = {
  signal?: AbortSignal;
  runStatus?: ExecutionRunRecord['status'];
  pauseRequested?: boolean;
};

/**
 * Pi / fetch often surfaces a controlled Host abort as a plain Agent `error`
 * (`The operation was aborted`, AbortError, etc.). Once the Host has already
 * requested pause/stop (or the Run is cancelling/terminal), that payload is
 * lifecycle noise: `run/terminal` owns the user-visible outcome.
 */
export function looksLikeProviderAbortMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'aborted' ||
    normalized.includes('operation was aborted') ||
    normalized.includes('request was aborted') ||
    normalized.includes('the run was cancelled') ||
    normalized.includes('this run was cancelled') ||
    normalized.includes('stream aborted') ||
    normalized.includes('aborterror')
  );
}

function isAbortErrorReason(reason: unknown): boolean {
  if (isRunAbortReason(reason)) return true;
  if (!reason || typeof reason !== 'object') return false;
  const record = reason as { name?: unknown; message?: unknown };
  if (record.name === 'AbortError') return true;
  return typeof record.message === 'string' && looksLikeProviderAbortMessage(record.message);
}

export function shouldSuppressControlledAbortError(
  event: AgentEvent,
  context: ControlledAbortErrorContext = {},
): boolean {
  if (event.type !== 'error') return false;

  const signal = context.signal;
  const abortLooking = looksLikeProviderAbortMessage(event.message);

  if (context.pauseRequested === true && abortLooking) {
    return true;
  }
  if (
    (context.runStatus === 'cancelling' ||
      context.runStatus === 'cancelled' ||
      context.runStatus === 'interrupted') &&
    abortLooking
  ) {
    return true;
  }

  if (signal?.aborted !== true) {
    return false;
  }
  // Structured Host reasons suppress any follow-on provider error for that Run.
  if (isRunAbortReason(signal.reason)) {
    return true;
  }
  // Generic AbortError / DOMException reasons only suppress abort-shaped
  // messages — a real upstream timeout must still surface.
  if (isAbortErrorReason(signal.reason)) {
    return abortLooking;
  }
  return abortLooking;
}
