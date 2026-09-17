/**
 * Pure composer activity rail: pill visibility, bilingual labels, and
 * stop-all targets for F1 orchestration items plus live jobs.
 */
import type { JobRecord } from '@piwin/contracts';
import { isOrchestrationExecutionActive } from './subagent-activity-model.js';
import type {
  SubagentOrchestrationItem,
  SubagentOrchestrationView,
} from './subagent-orchestration-view.js';

export type ComposerActivityLocale = 'zh-CN' | 'en';

export type ComposerActivityModel = {
  visible: boolean;
  workingCount: number;
  finishedCount: number;
  attentionCount: number;
  label: string;
  spinning: boolean;
  items: readonly SubagentOrchestrationItem[];
  jobs: readonly JobRecord[];
  stopRunIds: readonly string[];
  stopJobIds: readonly string[];
};

export const EMPTY_SUBAGENT_ORCHESTRATION_VIEW: SubagentOrchestrationView = {
  items: [],
  activeCount: 0,
  completedCount: 0,
  failedCount: 0,
  cancelledCount: 0,
  reportPendingCount: 0,
  integrationPendingCount: 0,
};

export function isComposerActivityAttentionItem(item: SubagentOrchestrationItem): boolean {
  if (isOrchestrationExecutionActive(item.executionStatus)) {
    return false;
  }
  if (item.executionStatus === 'failed' || item.executionStatus === 'cancelled') {
    return true;
  }
  if (item.summaryStatus === 'pending') {
    return true;
  }
  return item.integrationStatus === 'pending' || item.integrationStatus === 'conflict';
}

export function collectComposerActivityStopAllTargets(input: {
  items: readonly SubagentOrchestrationItem[];
  jobs: readonly JobRecord[];
}): { runIds: string[]; jobIds: string[] } {
  const runIds: string[] = [];
  const seenRuns = new Set<string>();
  for (const item of input.items) {
    if (!isOrchestrationExecutionActive(item.executionStatus) || item.runId === undefined) {
      continue;
    }
    if (seenRuns.has(item.runId)) {
      continue;
    }
    seenRuns.add(item.runId);
    runIds.push(item.runId);
  }
  return {
    runIds,
    jobIds: input.jobs.map((job) => job.jobId),
  };
}

/**
 * Finished work is split by outcome: a failed or stopped child is not "done",
 * and calling it that hides exactly the rows that need attention.
 */
export function formatComposerActivityLabel(input: {
  workingCount: number;
  finishedCount: number;
  failedCount?: number;
  cancelledCount?: number;
  locale: ComposerActivityLocale;
}): string {
  const { workingCount, locale } = input;
  const failedCount = input.failedCount ?? 0;
  const cancelledCount = input.cancelledCount ?? 0;
  const doneCount = Math.max(0, input.finishedCount - failedCount - cancelledCount);
  const isZh = locale === 'zh-CN';
  const parts: string[] = [];
  if (workingCount > 0) parts.push(isZh ? `${workingCount} 运行中` : `${workingCount} Working`);
  if (doneCount > 0) parts.push(isZh ? `${doneCount} 完成` : `${doneCount} done`);
  if (failedCount > 0) parts.push(isZh ? `${failedCount} 失败` : `${failedCount} failed`);
  if (cancelledCount > 0) {
    parts.push(isZh ? `${cancelledCount} 已停止` : `${cancelledCount} stopped`);
  }
  if (parts.length === 0) return isZh ? '0 完成' : '0 done';
  return parts.join(' · ');
}

export function deriveComposerActivityModel(input: {
  orchestration: SubagentOrchestrationView;
  jobs: readonly JobRecord[];
  locale: ComposerActivityLocale;
}): ComposerActivityModel {
  const workingCount = input.orchestration.activeCount + input.jobs.length;
  const finishedItems = input.orchestration.items.filter(
    (item) => !isOrchestrationExecutionActive(item.executionStatus),
  );
  const finishedCount = finishedItems.length;
  const attentionCount = finishedItems.filter(isComposerActivityAttentionItem).length;
  const stops = collectComposerActivityStopAllTargets({
    items: input.orchestration.items,
    jobs: input.jobs,
  });
  return {
    visible: workingCount > 0 || attentionCount > 0,
    workingCount,
    finishedCount,
    attentionCount,
    label: formatComposerActivityLabel({
      workingCount,
      finishedCount,
      failedCount: finishedItems.filter((item) => item.executionStatus === 'failed').length,
      cancelledCount: finishedItems.filter((item) => item.executionStatus === 'cancelled').length,
      locale: input.locale,
    }),
    spinning: workingCount > 0,
    items: input.orchestration.items,
    jobs: input.jobs,
    stopRunIds: stops.runIds,
    stopJobIds: stops.jobIds,
  };
}
