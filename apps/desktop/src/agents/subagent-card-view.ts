/**
 * Pure view model for the transcript subagent cards (Inkstone proto-13,
 * apps/docs/public/inkstone/proto-13-subagent-cards.html).
 *
 * The cards read only this small snapshot — never the child stream itself:
 * one row per delegation (title, identity, phase, "what it is doing now") and
 * one header per consecutive run of delegations. Rows are memoized on
 * `areSubagentRowViewsEqual`, so a row whose snapshot did not change is not
 * re-rendered when a sibling child streams.
 *
 * Host data only: the Host pushes no per-child token or tool-call counters,
 * so those prototype fields are not part of the view (see the module test).
 */
import type {
  SessionSummary,
  SubagentActivityView,
  SubagentControlDisplay,
  SubagentInvocation,
  SubagentInvocationActivity,
} from '@piwin/contracts';
import type { SubagentStreamState, ToolCardUi } from '../conversation/chat-reducer';
import {
  isOrchestrationExecutionActive,
  resolveSubagentLifecycleAxes,
  subagentCardAnchorId,
} from './subagent-activity-model';
import type { SubagentOrchestrationItem } from './subagent-orchestration-view';
import { resolveSubagentBatchBehaviorId, type BehaviorActivityId } from '../run-activity/behavior-activity.js';
import type { ModelOption } from '../models/model-options';
import { resolveModelDisplayName } from '../conversation/conversation-message-identity';
import {
  reviewLoopAttachLabel,
  type SubagentReviewLoopAttach,
} from './subagent-review-summary-model';
import { subagentUsageLabels, sumSubagentUsageLabel } from './subagent-usage-view';
import { firstTextLine, withoutSuccessVerdict } from '@piwin/host-client';

export type SubagentLocale = 'zh-CN' | 'en';

/** Fine-grained Host lifecycle, kept on the DOM as `data-status`. */
export type SubagentInvocationVisualStatus =
  | 'starting'
  | 'queued'
  | 'running'
  | 'completed'
  | 'needs-integration'
  | 'failed'
  | 'cancelled';

/** The prototype's row phases (plus cancelled, which the prototype never shows). */
export type SubagentRowPhase = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type SubagentRowBadge = {
  label: string;
  tone: 'warning' | 'danger';
  testId: string;
};

export type SubagentRowView = {
  /** Stable inspector anchor (invocation id, else tool call id). */
  anchorId: string;
  toolCallId: string;
  invocationId?: string;
  childSessionId?: string;
  status: SubagentInvocationVisualStatus;
  phase: SubagentRowPhase;
  behaviorId: BehaviorActivityId;
  title: string;
  seal: string;
  role?: string;
  modelLabel?: string;
  modelTitle?: string;
  /** Host-measured counters (`invocation.usage`); absent on older Hosts. */
  toolCalls?: number;
  totalTokens?: number;
  toolsLabel?: string;
  tokensLabel?: string;
  stateLabel: string;
  /** Attention badges; when present they take the state column (proto ④). */
  badges: readonly SubagentRowBadge[];
  /** Latest activity; also the accessible description of the row. */
  activity: string;
  /**
   * Second line. Every phase keeps it (a finished row shows its conclusion's
   * first line) so a row never changes height when its phase changes — the
   * fan-out wires depend on fixed row heights.
   */
  showActivity: boolean;
  reviewLoopLabel?: string;
  reviewLoopKind?: SubagentReviewLoopAttach['kind'];
  reviewLoopGeneration?: number;
  startedAt?: string;
  endedAt?: string;
  taskSummary: string;
  canInspect: boolean;
  expanded: boolean;
};

export type SubagentRowInput = {
  tool: ToolCardUi;
  invocation?: SubagentInvocation;
  child?: SessionSummary;
  stream?: SubagentStreamState;
  locale: SubagentLocale;
  modelOptions?: readonly ModelOption[];
  /** Host-derived orchestration item when the parent view has one. */
  orchestrationItem?: SubagentOrchestrationItem;
  /** F2 thin attach: generation/kind label only. Tree lives in SubagentReviewSummary. */
  reviewLoopAttach?: SubagentReviewLoopAttach;
  canInspect?: boolean;
  /** Whether the inline session panel is currently expanded below the row. */
  expanded?: boolean;
};

type LifecycleAxes = {
  executionStatus: SubagentInvocationVisualStatus;
  summaryStatus?: string;
  integrationStatus?: string;
};

function acceptedControl(
  tool: ToolCardUi,
): Extract<SubagentControlDisplay, { phase: 'accepted' }> | undefined {
  const control = tool.presentation?.subagentControl;
  return control?.phase === 'accepted' ? control : undefined;
}

function isAsyncStartTool(tool: ToolCardUi): boolean {
  const control = tool.presentation?.subagentControl;
  if (control?.phase === 'accepted') return true;
  if (control !== undefined) return false;
  return tool.toolName === 'piwin_subagent_start';
}

function visualStatus(
  execution: SubagentInvocationVisualStatus,
  integration?: string,
): SubagentInvocationVisualStatus {
  if (execution === 'queued' || execution === 'starting' || execution === 'running') {
    return execution;
  }
  if (execution === 'failed' || execution === 'cancelled') return execution;
  if (integration === 'pending' || integration === 'conflict') return 'needs-integration';
  return 'completed';
}

function axesFrom(axes: {
  executionStatus: SubagentInvocationVisualStatus;
  summaryStatus?: string | undefined;
  integrationStatus?: string | undefined;
}): LifecycleAxes {
  return {
    executionStatus: visualStatus(axes.executionStatus, axes.integrationStatus),
    ...(axes.summaryStatus !== undefined ? { summaryStatus: axes.summaryStatus } : {}),
    ...(axes.integrationStatus !== undefined ? { integrationStatus: axes.integrationStatus } : {}),
  };
}

export function resolveSubagentRowLifecycle(input: SubagentRowInput): LifecycleAxes {
  if (input.orchestrationItem) return axesFrom(input.orchestrationItem);
  if (input.invocation) {
    return axesFrom(
      resolveSubagentLifecycleAxes({
        invocation: input.invocation,
        ...(input.child !== undefined ? { child: input.child } : {}),
      }),
    );
  }
  if (isAsyncStartTool(input.tool)) {
    return { executionStatus: input.tool.status === 'error' ? 'failed' : 'queued' };
  }
  if (input.child) return axesFrom(resolveSubagentLifecycleAxes({ child: input.child }));
  if (input.tool.status === 'error') return { executionStatus: 'failed' };
  if (input.tool.status === 'done') return { executionStatus: 'completed' };
  return { executionStatus: 'starting' };
}

export function subagentInvocationActivityLabel(
  activity: SubagentInvocationActivity,
  locale: SubagentLocale,
): string {
  const zh = locale === 'zh-CN';
  switch (activity.kind) {
    case 'queued':
      return zh ? '等待调度' : 'Queued';
    case 'preparing':
      return zh ? '正在准备工作区' : 'Preparing workspace';
    case 'thinking':
      return zh ? '思考中' : 'Thinking';
    case 'responding':
      return zh ? '正在生成回复' : 'Responding';
    case 'tool':
      return zh
        ? `正在执行 ${activity.title ?? activity.toolName}`
        : `Running ${activity.title ?? activity.toolName}`;
    case 'permission':
      return zh ? `等待权限确认：${activity.action}` : `Waiting for permission: ${activity.action}`;
    case 'completed':
      return activity.summary?.trim() || (zh ? '已完成' : 'Completed');
    case 'needs-integration':
      return activity.message?.trim() || (zh ? '修改待处理' : 'Changes need attention');
    case 'failed':
      return activity.message?.trim() || (zh ? '子任务失败' : 'Subtask failed');
    case 'cancelled':
      return zh ? '已取消' : 'Cancelled';
  }
}

/** "What it is doing now": live stream first, then the Host's persisted activity. */
export function resolveSubagentRowActivity(
  input: SubagentRowInput,
  status: SubagentInvocationVisualStatus,
): string {
  const zh = input.locale === 'zh-CN';
  if (input.stream?.permissionPrompt) return zh ? '等待权限确认' : 'Waiting for permission';
  // The approval gate sits inside the running tool call, so the stream still
  // shows that tool as running; the Host-side wait must win over it.
  if (input.invocation?.activity.kind === 'permission') {
    return subagentInvocationActivityLabel(input.invocation.activity, input.locale);
  }
  const runningTool = [...(input.stream?.tools ?? [])]
    .reverse()
    .find((tool) => tool.status === 'running');
  if (runningTool) {
    return zh ? `正在执行 ${runningTool.toolName}` : `Running ${runningTool.toolName}`;
  }
  const text = input.stream?.text.trim();
  if (text) return text.replace(/\s+/g, ' ').slice(0, 160);
  if (input.stream?.thinking.trim()) return zh ? '思考中' : 'Thinking';
  if (input.invocation) return subagentInvocationActivityLabel(input.invocation.activity, input.locale);
  if (status === 'failed') {
    return input.tool.presentation?.error?.message?.trim() || (zh ? '子任务失败' : 'Subtask failed');
  }
  if (status === 'cancelled') return zh ? '已取消' : 'Cancelled';
  if (status === 'completed') {
    return input.child?.summaryPreview?.trim() || (zh ? '已完成' : 'Completed');
  }
  if (status === 'needs-integration') return zh ? '修改待处理' : 'Changes need attention';
  if (status === 'queued' || status === 'starting') return zh ? '正在启动' : 'Starting';
  return (
    input.child?.lastPreview?.trim() || input.child?.task?.trim() || (zh ? '工作中' : 'Working')
  );
}

const ROLE_CHAR_MAP: Record<string, string> = {
  // 熔金铸器：代码实现
  implementer: '铸',
  coder: '铸',
  code: '铸',
  developer: '铸',
  engineer: '铸',
  worker: '铸',
  sidekick: '铸',
  // 校书雠谬：代码审查
  reviewer: '校',
  review: '校',
  critic: '校',
  auditor: '校',
  // 前哨斥候：探索侦巡
  scout: '斥',
  explorer: '斥',
  research: '斥',
  search: '斥',
  searcher: '斥',
  // 勘验证伪：测试验收
  tester: '验',
  test: '验',
  qa: '验',
  // 修葺补阙：排错修复
  fixer: '补',
  fix: '补',
  debugger: '补',
  debug: '补',
  // 运筹定策：统筹规划
  planner: '筹',
  plan: '筹',
  // 居中定枢：系统架构
  architect: '枢',
  // 秉笔实录：文档撰写
  writer: '录',
  docs: '录',
  documentation: '录',
  // 百炼淬火：性能优化
  optimizer: '淬',
  optimize: '淬',
  // 条分缕析：剖析推演
  analyst: '析',
  analysis: '析',
};

export function resolveSubagentSealChar(
  role?: string,
  title?: string,
  locale: SubagentLocale = 'zh-CN',
): string {
  const cleanRole = role?.trim().toLowerCase();
  if (cleanRole && cleanRole in ROLE_CHAR_MAP) return ROLE_CHAR_MAP[cleanRole]!;
  const roleChinese = role?.match(/[\u4e00-\u9fa5]/);
  if (roleChinese?.[0]) return roleChinese[0];
  const titleChinese = title?.match(/[\u4e00-\u9fa5]/);
  if (titleChinese?.[0]) return titleChinese[0];
  if (cleanRole && cleanRole.length > 0) return cleanRole[0]!.toUpperCase();
  if (title && title.trim().length > 0) return title.trim()[0]!.toUpperCase();
  return locale === 'zh-CN' ? '子' : 'S';
}

export function subagentRowPhase(status: SubagentInvocationVisualStatus): SubagentRowPhase {
  switch (status) {
    case 'starting':
    case 'queued':
      return 'queued';
    case 'running':
      return 'running';
    case 'completed':
    case 'needs-integration':
      return 'done';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

function behaviorIdForStatus(status: SubagentInvocationVisualStatus): BehaviorActivityId {
  switch (status) {
    case 'starting':
    case 'queued':
      return 'subagent.task.queued';
    case 'running':
      return 'subagent.task.running';
    case 'completed':
    case 'needs-integration':
      return 'subagent.task.complete';
    case 'failed':
      return 'subagent.task.fail';
    case 'cancelled':
      return 'subagent.task.cancelled';
  }
}

const STATE_LABEL: Record<SubagentLocale, Record<SubagentRowPhase, string>> = {
  'zh-CN': { queued: '排队中', running: '运行中', done: '已完成', failed: '失败', cancelled: '已取消' },
  en: { queued: 'Queued', running: 'Running', done: 'Completed', failed: 'Failed', cancelled: 'Cancelled' },
};

export function subagentStateLabel(phase: SubagentRowPhase, locale: SubagentLocale): string {
  return STATE_LABEL[locale][phase];
}

/**
 * Results that still need the user (proto ④). A merged report is the normal
 * end state and earns no badge; only pending or broken axes do.
 */
export function subagentAttentionBadges(
  axes: LifecycleAxes,
  locale: SubagentLocale,
): SubagentRowBadge[] {
  if (
    isOrchestrationExecutionActive(
      axes.executionStatus === 'needs-integration' ? 'completed' : axes.executionStatus,
    )
  ) {
    return [];
  }
  const zh = locale === 'zh-CN';
  const badges: SubagentRowBadge[] = [];
  if (axes.summaryStatus === 'pending') {
    badges.push({
      tone: 'warning',
      label: zh ? '报告待收集' : 'Report pending',
      testId: 'subagent-badge-report-pending',
    });
  } else if (axes.summaryStatus === 'failed') {
    badges.push({
      tone: 'danger',
      label: zh ? '报告失败' : 'Report failed',
      testId: 'subagent-badge-summary-failed',
    });
  }
  if (axes.integrationStatus === 'pending') {
    badges.push({
      tone: 'warning',
      label: zh ? '代码待处理' : 'Code pending',
      testId: 'subagent-badge-code-pending',
    });
  } else if (axes.integrationStatus === 'conflict') {
    badges.push({
      tone: 'danger',
      label: zh ? '冲突' : 'Conflict',
      testId: 'subagent-badge-conflict',
    });
  } else if (axes.integrationStatus === 'failed') {
    badges.push({
      tone: 'danger',
      label: zh ? '合入失败' : 'Apply failed',
      testId: 'subagent-badge-integration-failed',
    });
  }
  return badges;
}

/** A finished row's line is its conclusion's first line, minus a bare verdict. */
function rowActivityLine(activity: string, phase: SubagentRowPhase): string {
  if (phase !== 'done') return activity;
  return firstTextLine(withoutSuccessVerdict(activity)) || activity;
}

export function deriveSubagentRowView(input: SubagentRowInput): SubagentRowView {
  const axes = resolveSubagentRowLifecycle(input);
  const status = axes.executionStatus;
  const phase = subagentRowPhase(status);
  const accepted = acceptedControl(input.tool);
  const invocationId =
    input.orchestrationItem?.invocationId ?? input.invocation?.id ?? accepted?.invocationId;
  const title =
    input.child?.name?.trim() ||
    input.invocation?.title?.trim() ||
    input.orchestrationItem?.title?.trim() ||
    input.tool.presentation?.summary?.trim() ||
    accepted?.task?.trim() ||
    input.invocation?.task?.trim() ||
    input.child?.task?.trim() ||
    (input.locale === 'zh-CN' ? '子代理任务' : 'Subagent task');
  const role =
    input.invocation?.role ?? input.child?.subagentRole ?? input.orchestrationItem?.role;
  const profileId = input.invocation?.profileId ?? input.child?.subagentProfileId;
  const roleLabel = role?.trim() || profileId?.trim() || undefined;
  const model = input.invocation?.model ?? input.child?.subagentModel;
  const modelLabel = model
    ? resolveModelDisplayName({
        model,
        ...(input.modelOptions ? { modelOptions: input.modelOptions } : {}),
      }).shortModelName
    : undefined;
  const startedAt = input.orchestrationItem?.startedAt ?? input.invocation?.createdAt;
  const endedAt = input.orchestrationItem?.updatedAt ?? input.invocation?.updatedAt;
  const attach = input.reviewLoopAttach;
  const usage = subagentUsageLabels(input.invocation?.usage, input.locale);
  return {
    anchorId: invocationId ?? input.tool.toolCallId,
    toolCallId: input.tool.toolCallId,
    ...(invocationId !== undefined ? { invocationId } : {}),
    ...(input.child !== undefined ? { childSessionId: input.child.id } : {}),
    status,
    phase,
    behaviorId: behaviorIdForStatus(status),
    title,
    seal: resolveSubagentSealChar(role ?? profileId, title, input.locale),
    ...(roleLabel !== undefined ? { role: roleLabel } : {}),
    ...(model && modelLabel
      ? { modelLabel, modelTitle: `${model.providerId} / ${model.modelId}` }
      : {}),
    ...(usage !== undefined
      ? {
          toolCalls: usage.toolCalls,
          totalTokens: usage.totalTokens,
          toolsLabel: usage.toolsLabel,
          ...(usage.tokensLabel !== undefined ? { tokensLabel: usage.tokensLabel } : {}),
        }
      : {}),
    stateLabel: subagentStateLabel(phase, input.locale),
    badges: subagentAttentionBadges(axes, input.locale),
    activity: rowActivityLine(resolveSubagentRowActivity(input, status), phase),
    showActivity: true,
    ...(attach !== undefined
      ? {
          reviewLoopLabel: reviewLoopAttachLabel(attach, input.locale),
          reviewLoopKind: attach.kind,
          ...(attach.candidateGeneration !== null
            ? { reviewLoopGeneration: attach.candidateGeneration }
            : {}),
        }
      : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(endedAt !== undefined ? { endedAt } : {}),
    taskSummary: input.child?.task ?? '',
    canInspect: input.canInspect === true && input.child !== undefined,
    expanded: input.expanded === true,
  };
}

const LEGACY_STATUS: Record<SubagentActivityView['state'], SubagentInvocationVisualStatus> = {
  started: 'running',
  running: 'running',
  completed: 'completed',
  merged: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

/**
 * Legacy sync-run transcript card (`message.subagentActivity`) as a lone row
 * (proto ③). The persisted card carries no timing or model, so the row shows
 * none; the task summary is the activity line while it is still open.
 */
export function deriveLegacySubagentRowView(input: {
  activity: SubagentActivityView;
  locale: SubagentLocale;
  canInspect: boolean;
  expanded: boolean;
}): SubagentRowView {
  const { activity, locale } = input;
  const status = LEGACY_STATUS[activity.state];
  const phase = subagentRowPhase(status);
  const anchorId = subagentCardAnchorId(activity.childSessionId);
  return {
    anchorId,
    toolCallId: anchorId,
    childSessionId: activity.childSessionId,
    status,
    phase,
    behaviorId: resolveSubagentBatchBehaviorId(activity.state),
    title: activity.displayName,
    seal: resolveSubagentSealChar(undefined, activity.displayName, locale),
    stateLabel: subagentStateLabel(phase, locale),
    badges: [],
    activity: activity.taskSummary,
    showActivity: true,
    taskSummary: activity.taskSummary,
    canInspect: input.canInspect,
    expanded: input.expanded,
  };
}

function badgesEqual(a: readonly SubagentRowBadge[], b: readonly SubagentRowBadge[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (badge, index) =>
      badge.testId === b[index]!.testId &&
      badge.label === b[index]!.label &&
      badge.tone === b[index]!.tone,
  );
}

/**
 * Value equality for the memoized row. Every field is a scalar except
 * `badges`, so a fresh view object with the same snapshot compares equal and
 * the row is skipped — the prototype's "检查多少次、实际重绘多少次" property.
 */
export function areSubagentRowViewsEqual(a: SubagentRowView, b: SubagentRowView): boolean {
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof SubagentRowView)[]);
  for (const key of keys) {
    if (key === 'badges') {
      if (!badgesEqual(a.badges, b.badges)) return false;
    } else if (a[key] !== b[key]) {
      return false;
    }
  }
  return true;
}

/* ── elapsed ─────────────────────────────────────────────────────────── */

/** Proto `formatElapsed`: `42s`, `3m 7s`. Empty when the span is unknown. */
export function formatSubagentElapsed(startMs: number, endMs: number): string {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return '';
  const seconds = Math.floor((endMs - startMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/* ── group ───────────────────────────────────────────────────────────── */

export type SubagentGroupSummary = {
  count: number;
  /** "2 完成 · 1 失败 · 1 运行中" */
  countsLabel: string;
  active: boolean;
  /** Some finished row still needs the user (badge) — keep the group open. */
  attention: boolean;
  /** Earliest row start (ISO); the header measures from here. */
  startedAt?: string;
  /** Latest row end (ISO) once every row settled; a live header ticks to now. */
  endedAt?: string;
  /** Settled total `N 工具 · Xk tok` (proto ②); absent when a row lacks Host counters. */
  usageLabel?: string;
};

export function deriveSubagentGroupSummary(
  rows: readonly SubagentRowView[],
  locale: SubagentLocale,
): SubagentGroupSummary {
  const counts: Record<SubagentRowPhase, number> = {
    done: 0,
    failed: 0,
    cancelled: 0,
    running: 0,
    queued: 0,
  };
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  for (const row of rows) {
    counts[row.phase] += 1;
    const rowStart = row.startedAt !== undefined ? Date.parse(row.startedAt) : Number.NaN;
    if (Number.isFinite(rowStart) && rowStart < start) {
      start = rowStart;
      startedAt = row.startedAt;
    }
    const rowEnd = row.endedAt !== undefined ? Date.parse(row.endedAt) : Number.NaN;
    if (Number.isFinite(rowEnd) && rowEnd > end) {
      end = rowEnd;
      endedAt = row.endedAt;
    }
  }
  const zh = locale === 'zh-CN';
  const parts: string[] = [];
  if (counts.done) parts.push(zh ? `${counts.done} 完成` : `${counts.done} done`);
  if (counts.failed) parts.push(zh ? `${counts.failed} 失败` : `${counts.failed} failed`);
  if (counts.cancelled) parts.push(zh ? `${counts.cancelled} 取消` : `${counts.cancelled} cancelled`);
  if (counts.running) parts.push(zh ? `${counts.running} 运行中` : `${counts.running} running`);
  if (counts.queued) parts.push(zh ? `${counts.queued} 排队` : `${counts.queued} queued`);
  const active = counts.running + counts.queued > 0;
  const usageLabel = sumSubagentUsageLabel(rows, locale);
  return {
    count: rows.length,
    countsLabel: parts.join(' · '),
    active,
    attention: rows.some((row) => row.badges.length > 0),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(!active && endedAt !== undefined ? { endedAt } : {}),
    ...(!active && usageLabel !== undefined ? { usageLabel } : {}),
  };
}

export function subagentGroupTitle(count: number, locale: SubagentLocale): string {
  return locale === 'zh-CN' ? `${count} 个子代理` : `${count} subagent${count === 1 ? '' : 's'}`;
}

/**
 * Proto ① / ②: a live group stays open; once every row has settled it folds
 * into its header — unless a result needs the user (④) or a row's session
 * is open. An explicit header click always wins.
 */
export function resolveSubagentGroupExpanded(input: {
  userChoice: boolean | null;
  summary: Pick<SubagentGroupSummary, 'active' | 'attention'>;
  hasOpenRow: boolean;
}): boolean {
  if (input.userChoice !== null) return input.userChoice;
  return input.hasOpenRow || input.summary.active || input.summary.attention;
}

/**
 * Split a rendered tool sequence into consecutive delegation runs (one group
 * card each) and everything else, keeping provider order.
 */
export type SubagentSegment<T> =
  | { kind: 'subagents'; items: T[] }
  | { kind: 'item'; item: T };

export function segmentSubagentRuns<T>(
  items: readonly T[],
  isSubagent: (item: T) => boolean,
): SubagentSegment<T>[] {
  const segments: SubagentSegment<T>[] = [];
  for (const item of items) {
    if (!isSubagent(item)) {
      segments.push({ kind: 'item', item });
      continue;
    }
    const last = segments[segments.length - 1];
    if (last?.kind === 'subagents') {
      last.items.push(item);
    } else {
      segments.push({ kind: 'subagents', items: [item] });
    }
  }
  return segments;
}
