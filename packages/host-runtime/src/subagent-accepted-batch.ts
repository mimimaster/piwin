/**
 * Shared accept/observe for model-facing start and reviewed continue.
 * Admission is released when the accepted child is observed to finish.
 */
import {
  formatError,
  type SubagentBatchResult,
  type SubagentTaskResult,
  type ToolResultErrorCode,
} from '@piwin/contracts';

export class SubagentControlError extends Error {
  readonly code: ToolResultErrorCode;
  readonly cancelled?: boolean;

  constructor(code: ToolResultErrorCode, message: string, cancelled?: boolean) {
    super(message);
    this.name = 'SubagentControlError';
    this.code = code;
    if (cancelled) this.cancelled = true;
  }
}

export type AcceptedBatchHandle = {
  runId: string;
  accepted: Promise<void>;
  hasAccepted: () => boolean;
  completion: Promise<SubagentBatchResult>;
};

export type AcceptedBatchObservation = {
  handle: AcceptedBatchHandle;
  releaseAdmission: () => void;
};

export function cacheBatchResults(
  deps: { taskResults: Map<string, SubagentTaskResult> },
  result: SubagentBatchResult,
): void {
  for (const taskResult of result.results) {
    if (taskResult.childSessionId) {
      deps.taskResults.set(taskResult.childSessionId, taskResult);
    }
  }
}

export function observeAcceptedBatch(
  deps: { taskResults: Map<string, SubagentTaskResult> },
  prepared: AcceptedBatchObservation,
): void {
  void prepared.handle.completion
    .then((result) => {
      cacheBatchResults(deps, result);
    })
    .catch(() => {})
    .finally(() => {
      prepared.releaseAdmission();
    });
}

export async function awaitAcceptedBatch(
  deps: {
    orchestrator: {
      cancelBatch: (runId: string) => Promise<unknown>;
    };
  },
  handle: AcceptedBatchHandle,
  signal?: AbortSignal,
): Promise<void> {
  let abortBeforeAccept = false;
  const cancelBatch = (): void => {
    if (handle.hasAccepted()) return;
    abortBeforeAccept = true;
    void deps.orchestrator.cancelBatch(handle.runId).catch(() => {});
  };
  if (signal?.aborted) {
    cancelBatch();
  } else if (signal) {
    signal.addEventListener('abort', cancelBatch, { once: true });
  }
  try {
    await handle.accepted;
  } catch (error) {
    throw new SubagentControlError('subagent-failed', formatError(error));
  } finally {
    if (signal) {
      signal.removeEventListener('abort', cancelBatch);
    }
  }
  if (abortBeforeAccept && !handle.hasAccepted()) {
    throw new SubagentControlError('aborted', 'aborted before subagent acceptance', true);
  }
}
