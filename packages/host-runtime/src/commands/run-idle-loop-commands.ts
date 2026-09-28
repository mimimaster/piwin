/**
 * `run/idle-loop-dismiss`: the only exit of the idle-loop card
 * (docs/plans/2026-09-28-run-idle-loop-notice.md). Marks the notice dismissed
 * on the live Run (so every shell hides it) and on persisted transcript rows
 * (so it stays hidden after reload). Never touches the Run's lifecycle.
 */

import type { HostCommand, HostResponse } from '@piwin/contracts';
import { fail, ok } from '../response-helpers.js';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';

type DismissCommand = Extract<HostCommand, { type: 'run/idle-loop-dismiss' }>;

export type RunIdleLoopDismissResult = {
  /** A live Run notice was updated and republished. */
  live: boolean;
  /** Persisted transcript rows updated. */
  persistedRows: number;
};

export async function handleRunIdleLoopDismiss(
  deps: HostRuntimeKernel,
  command: DismissCommand,
  requestId: string | undefined,
): Promise<HostResponse> {
  const run = deps.runRegistry.get(command.runId);
  if (run !== undefined && run.sessionId !== command.sessionId) {
    return fail(requestId, command.type, 'Run does not belong to this session');
  }
  // Live first: a Run that has not terminated yet has no stamped rows, and
  // its terminal stamp copies the dismissed flag from the monitor snapshot.
  const live = deps.runIdleLoopMonitor.dismiss(command.runId);
  const persistedRows = await deps.withTranscriptStore(command.sessionId, (store) =>
    store.dismissRunIdleLoop(command.runId),
  );
  const result: RunIdleLoopDismissResult = { live, persistedRows };
  return ok(requestId, command.type, result);
}
