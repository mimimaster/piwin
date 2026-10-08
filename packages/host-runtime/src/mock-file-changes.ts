/**
 * File changes for the mock Host.
 *
 * The turn-change runtime is self-contained, so an opted-in mock Host runs the
 * real one (without the retention sweeper): a shell then records, diffs and
 * undoes turns through the same commands the desktop uses. Only composed when
 * `mockFileChanges` is set, because the mock session writes a real file.
 */
import type { TurnChangeObjectStore, TurnChangeWriteReceipt } from '@piwin/git';

import type { HostRuntimeKernel } from './host-runtime-kernel.js';
import type { HostRuntimeOptions } from './host-runtime-types.js';
import { openTurnChangeRuntime } from './turn-changes/runtime-wiring.js';

export type MockFileChangeRecorder = (
  sessionId: string,
  receipt: TurnChangeWriteReceipt,
  workspaceRoot: string,
) => void;

export function composeMockFileChanges(
  deps: HostRuntimeKernel,
  options: HostRuntimeOptions,
): { recordMockFileChange: MockFileChangeRecorder; mockObjectStore: TurnChangeObjectStore } {
  const runtime = openTurnChangeRuntime({
    hostInstanceId: deps.hostInstanceId,
    ...(options.piwinRoot !== undefined ? { piwinRoot: options.piwinRoot } : {}),
    push: (message) => deps.push(message),
  });
  deps.turnChangeRuntime = runtime;
  return {
    recordMockFileChange: (sessionId, receipt, workspaceRoot) => {
      // The mock session runs outside the turn's async context, so the run id
      // comes from the session's running turn instead of the context.
      const runId = deps.runRegistry
        .list()
        .find((run) => run.sessionId === sessionId && run.status === 'running')?.runId;
      if (runId === undefined) return;
      const capture = runtime.capture.beginCapture({
        runId,
        toolCallId: undefined,
        toolName: 'mock_edit',
        fileEffect: {
          kind: 'exact-paths',
          pathsFromArgs: (args) => [String(args.path)],
        },
        canonicalArgs: { path: receipt.relativePath },
      });
      if (!capture) return;
      runtime.capture.recordReceipt({ captureId: capture.captureId, receipt, workspaceRoot });
      void runtime.capture.finishCapture({
        captureId: capture.captureId,
        result: { ok: true, output: receipt.relativePath },
      });
    },
    mockObjectStore: runtime.objectStore,
  };
}
