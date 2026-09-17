/**
 * Composer activity rail side effects. Host calls stay on the two existing
 * APIs: `subagent/batch-cancel` and `job/stop` / `job/logs`.
 */
import { subagentInvocationDomId } from './subagent-orchestration-view.js';
import type { SubagentOrchestrationItem } from './subagent-orchestration-view.js';

export function openComposerJobLogs(input: {
  jobId: string;
  selectJob: (jobId: string) => void;
  loadJobLogs: (jobId: string) => void | Promise<void>;
  openTerminal: () => void;
}): void {
  input.selectJob(input.jobId);
  void input.loadJobLogs(input.jobId);
  input.openTerminal();
}

export function focusComposerSubagentItem(
  item: SubagentOrchestrationItem,
  openTasks: () => void,
): void {
  const invocationId = item.invocationId;
  if (invocationId !== undefined) {
    const element = document.getElementById(subagentInvocationDomId(invocationId));
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center' });
      element.focus();
      return;
    }
  }
  openTasks();
}

export function applyComposerStopAll(input: {
  runIds: readonly string[];
  jobIds: readonly string[];
  cancelBatch: (runId: string) => void;
  /** Batch-aware stop that confirms once for the whole set. */
  cancelBatches?: (runIds: readonly string[]) => void;
  stopJob: (jobId: string) => void;
}): void {
  if (input.cancelBatches && input.runIds.length > 0) {
    input.cancelBatches(input.runIds);
  } else {
    for (const runId of input.runIds) {
      input.cancelBatch(runId);
    }
  }
  for (const jobId of input.jobIds) {
    input.stopJob(jobId);
  }
}

export function shouldRefreshJobList(input: {
  supportsJobList: boolean;
  hasActiveSession: boolean;
}): boolean {
  return input.supportsJobList && input.hasActiveSession;
}
