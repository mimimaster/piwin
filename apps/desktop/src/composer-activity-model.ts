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

export function formatComposerActivityLabel(input: {
  workingCount: number;
  finishedCount: number;
  locale: ComposerActivityLocale;
}): string {
  const { workingCount, finishedCount, locale } = input;
  const isZh = locale === 'zh-CN';
  if (workingCount > 0 && finishedCount > 0) {
    return isZh
      ? `${workingCount} 运行中 · ${finishedCount} 完成`
      : `${workingCount} Working · ${finishedCount} done`;
  }
  if (workingCount > 0) {
    return isZh ? `${workingCount} 运行中` : `${workingCount} Working`;
  }
  return isZh ? `${finishedCount} 完成` : `${finishedCount} done`;
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
      locale: input.locale,
    }),
    spinning: workingCount > 0,
    items: input.orchestration.items,
    jobs: input.jobs,
    stopRunIds: stops.runIds,
    stopJobIds: stops.jobIds,
  };
}
