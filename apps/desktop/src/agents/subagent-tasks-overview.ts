/**
 * Presentation grouping for the right-panel / Settings Tasks overview.
 * Consumes the F1 orchestration view; does not re-interpret Host records.
 */
import type {
  SessionSummary,
  SubagentActivityView,
  SubagentBatchProjection,
} from '@piwin/contracts';
import { isOrchestrationExecutionActive } from './subagent-activity-model.js';
import type {
  SubagentOrchestrationItem,
  SubagentOrchestrationView,
} from './subagent-orchestration-view.js';

/** Terminal rows kept after active batches in the Tasks list. */
export const MAX_RECENT_TASK_ITEMS = 16;

export type TasksOverviewBatch = {
  runId: string;
  items: SubagentOrchestrationItem[];
  total: number;
  active: number;
  completed: number;
  needsConfirm: boolean;
  cancellable: boolean;
};

export type TasksOverview = {
  activeBatches: TasksOverviewBatch[];
  recentItems: SubagentOrchestrationItem[];
};

function isItemActive(item: SubagentOrchestrationItem): boolean {
  return isOrchestrationExecutionActive(item.executionStatus);
}

function isIntegrationAttention(item: SubagentOrchestrationItem): boolean {
  return item.integrationStatus === 'pending' || item.integrationStatus === 'conflict';
}

export function childSummariesToLegacyActivities(
  children: readonly SessionSummary[],
): SubagentActivityView[] {
  return children.map((child) => {
    const state = childActivityState(child);
    return {
      childSessionId: child.id,
      displayName: child.name?.trim() || child.task?.trim() || 'Subagent task',
      taskSummary: child.lastPreview?.trim() || child.task?.trim() || '',
      state,
      updatedAt: child.updatedAt,
      ...(child.worktreePath !== undefined ? { worktreePath: child.worktreePath } : {}),
    };
  });
}

function childActivityState(child: SessionSummary): SubagentActivityView['state'] {
  if (child.subagentExecutionStatus !== undefined) {
    switch (child.subagentExecutionStatus) {
      case 'queued':
        return 'started';
      case 'running':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
        return 'failed';
      case 'cancelled':
        return 'cancelled';
    }
  }
  switch (child.subagentStatus) {
    case 'running':
      return 'running';
    case 'done':
      return 'completed';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'running';
  }
}

export function formatTasksBatchHeader(
  counts: { total: number; active: number; completed: number },
  locale: 'zh-CN' | 'en',
): string {
  const zh = locale === 'zh-CN';
  if (counts.total === 0) {
    return zh ? '后台任务 · 运行中' : 'Background tasks · running';
  }
  return zh
    ? `后台任务 ${counts.total} · 运行中 ${counts.active} · 已完成 ${counts.completed}`
    : `Background tasks ${counts.total} · running ${counts.active} · completed ${counts.completed}`;
}

export function orchestrationItemDurationMs(item: SubagentOrchestrationItem): number | undefined {
  if (item.startedAt === undefined) {
    return undefined;
  }
  const started = Date.parse(item.startedAt);
  const ended = Date.parse(item.updatedAt);
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) {
    return undefined;
  }
  const duration = ended - started;
  return duration > 0 ? duration : undefined;
}

export function batchNeedsCancelConfirm(
  items: readonly SubagentOrchestrationItem[],
  batch?: SubagentBatchProjection,
): boolean {
  if (batch?.status === 'needs-integration') {
    return true;
  }
  return items.some((item) => isIntegrationAttention(item));
}

export function groupTasksOverview(input: {
  view: SubagentOrchestrationView;
  batches?: Record<string, SubagentBatchProjection>;
}): TasksOverview {
  const batches = input.batches ?? {};
  const grouped = new Map<string, SubagentOrchestrationItem[]>();
  const ungrouped: SubagentOrchestrationItem[] = [];

  for (const item of input.view.items) {
    if (item.runId === undefined) {
      ungrouped.push(item);
      continue;
    }
    const current = grouped.get(item.runId) ?? [];
    current.push(item);
    grouped.set(item.runId, current);
  }

  const activeBatches: TasksOverviewBatch[] = [];
  const terminalFromBatches: SubagentOrchestrationItem[] = [];
  const activeLoose = ungrouped.filter(isItemActive);
  if (activeLoose.length > 0) {
    activeBatches.push({
      runId: 'loose',
      items: activeLoose,
      total: activeLoose.length,
      active: activeLoose.length,
      completed: 0,
      needsConfirm: batchNeedsCancelConfirm(activeLoose),
      cancellable: false,
    });
  }

  for (const [runId, items] of grouped) {
    const batch = batches[runId];
    const active = items.filter(isItemActive).length;
    const completed = items.length - active;
    const runningBatch = batch?.status === 'running';
    if (active > 0 || runningBatch) {
      activeBatches.push({
        runId,
        items,
        total: items.length,
        active: runningBatch && active === 0 ? Math.max(active, 1) : active,
        completed,
        needsConfirm: batchNeedsCancelConfirm(items, batch),
        cancellable: runningBatch || active > 0,
      });
      continue;
    }
    terminalFromBatches.push(...items);
  }

  for (const [runId, batch] of Object.entries(batches)) {
    if (batch.status !== 'running' || grouped.has(runId)) {
      continue;
    }
    activeBatches.push({
      runId,
      items: [],
      total: 0,
      active: 0,
      completed: 0,
      needsConfirm: batchNeedsCancelConfirm([], batch),
      cancellable: true,
    });
  }

  activeBatches.sort((left, right) => {
    if (left.active !== right.active) {
      return right.active - left.active;
    }
    return left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0;
  });

  const recentSource = [...ungrouped.filter((item) => !isItemActive(item)), ...terminalFromBatches];
  recentSource.sort((left, right) => {
    const timeDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }
    return left.anchorId < right.anchorId ? -1 : left.anchorId > right.anchorId ? 1 : 0;
  });

  return {
    activeBatches,
    recentItems: recentSource.slice(0, MAX_RECENT_TASK_ITEMS),
  };
}
