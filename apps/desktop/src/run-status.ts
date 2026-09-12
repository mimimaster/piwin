/**
 * Presentation-only agent run status derived from existing desktop state.
 */
import type { JobRecord, SessionPlan } from '@piwin/contracts';
import { isJobActive } from '@piwin/contracts';
import type { ChatUiState, ToolCardUi } from './chat-reducer';

export type RunStatusKind =
  | 'idle'
  | 'preparing'
  | 'connecting-model'
  | 'waiting-first-token'
  | 'waiting-resource'
  | 'waiting-subagents'
  | 'planning'
  | 'working'
  | 'waiting-permission'
  | 'compacting'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'complete';

export type RunStatusPrimaryAction = 'view-activity' | 'review-permission' | 'view-plan' | 'retry';

export type RunStatusSettlementDetail = 'joining' | 'synthesizing';

export type RunStatusView = {
  kind: RunStatusKind;
  label: string;
  summary: string;
  activeToolName?: string;
  completedToolCount: number;
  runningJobCount: number;
  primaryAction?: RunStatusPrimaryAction;
  canStop: boolean;
  elapsedMs?: number;
  planStep?: string;
  /** Present while the parent run is joining or synthesizing async subagent work. */
  settlementDetail?: RunStatusSettlementDetail;
};

export type DeriveRunStatusInput = {
  chat: ChatUiState;
  tools: ToolCardUi[];
  plan: SessionPlan | null;
  jobs: JobRecord[];
  /** Optional locale for presentation labels (defaults to English). */
  locale?: 'en' | 'zh-CN';
};

const PHASE_ELAPSED_VISIBLE_MS = 3_000;
const SLOW_PROVIDER_HINT_MS = 30_000;

function resolvePhaseElapsedMs(chat: ChatUiState): number | undefined {
  if (chat.activeRunPhaseUpdatedAt !== null) {
    return Math.max(0, Date.now() - chat.activeRunPhaseUpdatedAt);
  }
  if (chat.activeRunStartedAt !== null) {
    return Math.max(0, Date.now() - chat.activeRunStartedAt);
  }
  return undefined;
}

function visibleElapsedMs(elapsedMs: number | undefined): number | undefined {
  if (elapsedMs === undefined || elapsedMs < PHASE_ELAPSED_VISIBLE_MS) {
    return undefined;
  }
  return elapsedMs;
}

export function deriveRunStatus(input: DeriveRunStatusInput): RunStatusView {
  const tools = input.tools;
  const completedToolCount = tools.filter((tool) => tool.status === 'done').length;
  const runningTool = tools.find((tool) => tool.status === 'running');
  const runningJobCount = input.jobs.filter((job) => isJobActive(job.status)).length;
  const baseCounts = {
    completedToolCount,
    runningJobCount,
  };

  const activePhase = input.chat.activeRunPhase;
  if (
    activePhase === 'accepted' ||
    activePhase === 'preparing' ||
    activePhase === 'connecting-model' ||
    activePhase === 'waiting-first-token'
  ) {
    const labels: Record<
      typeof activePhase,
      { label: string; summary: string; kind: RunStatusKind }
    > = {
      accepted: { kind: 'preparing', label: 'Accepted', summary: 'Preparing the agent run…' },
      preparing: { kind: 'preparing', label: 'Preparing', summary: 'Preparing the agent run…' },
      'connecting-model': {
        kind: 'connecting-model',
        label: 'Connecting',
        summary: 'Connecting to the model…',
      },
      'waiting-first-token': {
        kind: 'waiting-first-token',
        label: 'Waiting',
        summary: 'Waiting for the first model token…',
      },
    };
    const status = labels[activePhase];
    const detail = input.chat.activeRunPhaseDetail?.trim();
    const phaseElapsedMs = resolvePhaseElapsedMs(input.chat);
    const isZh = input.locale === 'zh-CN';
    let summary = status.summary;
    if (activePhase === 'waiting-first-token') {
      summary = isZh ? '正在等待模型响应…' : 'Waiting for the first model token…';
      if (phaseElapsedMs !== undefined && phaseElapsedMs >= SLOW_PROVIDER_HINT_MS) {
        const seconds = Math.floor(phaseElapsedMs / 1000);
        summary = isZh
          ? `provider 响应缓慢 · 已等待 ${seconds}s`
          : `Provider is slow · waited ${seconds}s`;
      }
    }
    const shownElapsed = visibleElapsedMs(phaseElapsedMs);
    return {
      ...status,
      ...(detail
        ? {
            label: activePhase === 'preparing' ? 'Describing' : status.label,
            summary: detail,
          }
        : { summary }),
      ...baseCounts,
      canStop: true,
      ...(shownElapsed !== undefined ? { elapsedMs: shownElapsed } : {}),
    };
  }

  // ADR 0040: cold prompt waiting for runtime capacity — subtle restoring phase.
  if (activePhase === 'waiting-subagents') {
    const isZh = input.locale === 'zh-CN';
    const synthesizing = input.chat.activeRunPhaseDetail === 'synthesizing-reports';
    const settlementDetail: RunStatusSettlementDetail = synthesizing ? 'synthesizing' : 'joining';
    const phaseElapsedMs = resolvePhaseElapsedMs(input.chat);
    const shownElapsed = visibleElapsedMs(phaseElapsedMs);
    return {
      kind: 'waiting-subagents',
      label: synthesizing
        ? isZh
          ? '汇总子任务'
          : 'Synthesizing subtasks'
        : isZh
          ? '等待子代理'
          : 'Waiting for subagents',
      summary: synthesizing
        ? isZh
          ? '正在汇总子任务结果…'
          : 'Synthesizing subtask results…'
        : isZh
          ? '等待子代理结果…'
          : 'Waiting for subagent results…',
      settlementDetail,
      ...baseCounts,
      primaryAction: 'view-activity',
      canStop: true,
      ...(shownElapsed !== undefined ? { elapsedMs: shownElapsed } : {}),
    };
  }

  if (activePhase === 'waiting-resource') {
    const isZh = input.locale === 'zh-CN';
    const waitingExecution = input.chat.activeRunPhaseDetail === 'execution-slot';
    return {
      kind: 'waiting-resource',
      label: waitingExecution
        ? isZh
          ? '等待执行槽位'
          : 'Waiting for a run slot'
        : isZh
          ? '等待运行时容量'
          : 'Waiting for runtime capacity',
      summary: waitingExecution
        ? isZh
          ? '任务已接受，正在等待执行槽位…'
          : 'The run was accepted and is waiting for an execution slot…'
        : isZh
          ? '任务已接受，正在等待运行时容量…'
          : 'The run was accepted and is waiting for runtime capacity…',
      ...baseCounts,
      canStop: true,
      ...(input.chat.activeRunStartedAt !== null
        ? { elapsedMs: Math.max(0, Date.now() - input.chat.activeRunStartedAt) }
        : {}),
    };
  }

  if (input.chat.runPhase === 'aborting') {
    return {
      kind: 'stopping',
      label: 'Stopping',
      summary: 'Stopping the current agent run…',
      ...baseCounts,
      canStop: false,
      ...(runningTool ? { activeToolName: runningTool.toolName } : {}),
      ...(input.chat.activeRunStartedAt !== null
        ? { elapsedMs: Math.max(0, Date.now() - input.chat.activeRunStartedAt) }
        : {}),
    };
  }

  if (input.chat.runPhase === 'pausing') {
    const isZh = input.locale === 'zh-CN';
    return {
      kind: 'stopping',
      label: isZh ? '正在暂停' : 'Pausing',
      summary: isZh ? '正在保存可继续的检查点…' : 'Saving a resumable checkpoint…',
      ...baseCounts,
      canStop: false,
      ...(runningTool ? { activeToolName: runningTool.toolName } : {}),
      ...(input.chat.activeRunStartedAt !== null
        ? { elapsedMs: Math.max(0, Date.now() - input.chat.activeRunStartedAt) }
        : {}),
    };
  }

  if (input.chat.permissionPrompt) {
    return {
      kind: 'waiting-permission',
      label: 'Needs permission',
      summary: input.chat.permissionPrompt.action || 'Permission required',
      ...baseCounts,
      primaryAction: 'review-permission',
      canStop: true,
    };
  }

  if (input.chat.compacting) {
    return {
      kind: 'compacting',
      label: 'Compacting',
      summary: 'Compacting context…',
      ...baseCounts,
      canStop: false,
    };
  }

  if (input.chat.runPhase === 'streaming' || runningTool || runningJobCount > 0) {
    const planInProgress =
      input.plan &&
      (input.plan.status === 'draft' ||
        input.plan.status === 'approved' ||
        input.plan.status === 'executing') &&
      !runningTool;
    if (planInProgress && input.plan) {
      const step =
        input.plan.steps.find((item) => item.status === 'active') ??
        input.plan.steps.find((item) => item.status !== 'done');
      return {
        kind: 'planning',
        label: 'Planning',
        summary: step?.title ?? input.plan.title ?? 'Building a plan',
        ...baseCounts,
        primaryAction: 'view-plan',
        canStop: true,
        ...(step?.title !== undefined ? { planStep: step.title } : {}),
        ...(input.chat.activeRunStartedAt !== null
          ? { elapsedMs: Math.max(0, Date.now() - input.chat.activeRunStartedAt) }
          : {}),
      };
    }
    return {
      kind: 'working',
      label: 'Working',
      summary: runningTool
        ? `Running ${runningTool.toolName}`
        : runningJobCount > 0
          ? `${runningJobCount} process${runningJobCount === 1 ? '' : 'es'} active`
          : 'Agent is responding…',
      ...baseCounts,
      primaryAction: 'view-activity',
      canStop: true,
      ...(runningTool ? { activeToolName: runningTool.toolName } : {}),
      ...(input.chat.activeRunStartedAt !== null
        ? { elapsedMs: Math.max(0, Date.now() - input.chat.activeRunStartedAt) }
        : {}),
    };
  }

  const terminal = input.chat.runTerminal;
  if (terminal.kind === 'stopped') {
    return {
      kind: 'stopped',
      label: 'Stopped',
      summary: 'Run stopped by user',
      ...baseCounts,
      canStop: false,
    };
  }
  if (terminal.kind === 'failed' || input.chat.error) {
    return {
      kind: 'failed',
      label: 'Run failed',
      summary:
        terminal.kind === 'failed' ? terminal.message : (input.chat.error ?? 'Unknown error'),
      ...baseCounts,
      primaryAction: 'retry',
      canStop: false,
    };
  }
  if (
    terminal.kind === 'complete' &&
    (completedToolCount > 0 || runningJobCount > 0 || Boolean(input.plan))
  ) {
    return {
      kind: 'complete',
      label: 'Complete',
      summary:
        completedToolCount > 0
          ? `${completedToolCount} tool${completedToolCount === 1 ? '' : 's'} complete`
          : 'Run finished',
      ...baseCounts,
      primaryAction: 'view-activity',
      canStop: false,
    };
  }

  return {
    kind: 'idle',
    label: 'Idle',
    summary: 'Ready',
    ...baseCounts,
    canStop: false,
  };
}
