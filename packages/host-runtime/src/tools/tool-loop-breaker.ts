/**
 * Fail a Run that the inspect-loop detector declared stalled.
 *
 * Must abort the live Pi session as well as the Run signal: built-in
 * read/grep never pass Host admission, so refusing the next Host tool
 * would not stop the loop. The prompt owner terminalizes via
 * `finalizeAbortedRun`, which maps this abort reason to `failed`.
 */

import { formatError, isRunTerminal } from '@piwin/contracts';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { createToolLoopStallAbortReason } from '../run-abort-reason.js';

export function failRunForToolLoopStall(
  deps: HostRuntimeKernel,
  input: { sessionId: string; runId: string; message: string },
): void {
  const run = deps.runRegistry.get(input.runId);
  if (!run || run.sessionId !== input.sessionId || isRunTerminal(run.status)) {
    return;
  }
  deps.runRegistry.updatePhase(input.runId, 'cancelling', input.message);
  deps.runRegistry.requestCancel(input.runId, createToolLoopStallAbortReason(input.message));
  const abortLiveSession = deps.abortLiveSession;
  if (typeof abortLiveSession !== 'function') {
    return;
  }
  void abortLiveSession.call(deps, input.sessionId).catch((error: unknown) => {
    deps.push({
      type: 'host/log',
      level: 'warn',
      message: `tool-loop stall abort failed for ${input.sessionId}: ${formatError(error)}`,
    });
  });
}
