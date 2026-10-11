/**
 * Pure view for the expanded row detail (Inkstone proto-13 inline box):
 *
 *   step N · 运行中
 *   <what it is doing now / 已完成：conclusion / 失败：reason>
 *   ▸ N 次工具调用 · 保留最近 20 步      (toggles the recent steps)
 *   打开完整会话 →
 *
 * Every line comes from Host data: N is the Host-counted tool calls
 * (`invocation.usage`), the conclusion is the invocation's persisted
 * activity or the child summary. A field the Host did not send is omitted.
 */
import type { SessionSummary, SubagentInvocation } from '@piwin/contracts';
import type { SubagentStreamState } from './chat-ui-types';
import type { ActiveSubagentStatus } from './subagent-activity-model';
import { subagentInvocationActivityLabel, type SubagentLocale } from './subagent-card-view';
import { formatSubagentToolCalls } from './subagent-usage-view';

/** Persisted messages the inline box renders; the full session keeps the rest. */
export const SUBAGENT_INLINE_RECENT_STEPS = 20;

const STATUS_LABEL: Record<SubagentLocale, Record<ActiveSubagentStatus, string>> = {
  'zh-CN': {
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  },
  en: {
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    cancelled: 'Cancelled',
  },
};

export function subagentInlineStatusLabel(
  status: ActiveSubagentStatus,
  locale: SubagentLocale,
): string {
  return STATUS_LABEL[locale][status];
}

export type SubagentInlineTone = 'live' | 'done' | 'failed' | 'muted';

export type SubagentInlineDetail = {
  /** `step 4 · 运行中`; just the status when the Host sent no counters. */
  stepLabel: string;
  conclusion: string;
  tone: SubagentInlineTone;
  /** `4 次工具调用`; absent on older Hosts. */
  toolCallsLabel?: string;
  retainedLabel: string;
  openFullLabel: string;
};

export type SubagentInlineInput = {
  status: ActiveSubagentStatus;
  invocation?: SubagentInvocation | undefined;
  child?: SessionSummary | undefined;
  liveTail?: SubagentStreamState | null | undefined;
  locale: SubagentLocale;
};

function trimmed(value: string | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text : undefined;
}

/**
 * A scheme report contract opens the child's last message with a verdict line
 * (`complete`, `done`, `pass`). After 「已完成」 that word only repeats the
 * status, so drop it (and the bullet it leaves leading) from the conclusion.
 * Other verdicts (`partial`, `blocked`, …) carry news and stay.
 */
function withoutSuccessVerdict(value: string | undefined): string | undefined {
  if (!value) return value;
  const match = /^\s*(?:complete|done|pass)[ \t]*(?:\r?\n|$)/i.exec(value);
  if (!match) return value;
  return value.slice(match[0].length).replace(/^\s*[-*•]\s+/, '');
}

function resolveConclusion(input: SubagentInlineInput): { text: string; tone: SubagentInlineTone } {
  const zh = input.locale === 'zh-CN';
  const activity = input.invocation?.activity;
  switch (input.status) {
    case 'queued':
    case 'running': {
      if (input.liveTail?.permissionPrompt) {
        return { text: zh ? '等待权限确认' : 'Waiting for permission', tone: 'live' };
      }
      const text =
        (activity ? subagentInvocationActivityLabel(activity, input.locale) : undefined) ??
        trimmed(input.child?.lastPreview) ??
        (zh ? '工作中' : 'Working');
      return { text, tone: 'live' };
    }
    case 'completed': {
      const summary =
        (activity?.kind === 'completed' ? trimmed(withoutSuccessVerdict(activity.summary)) : undefined) ??
        (activity?.kind === 'needs-integration'
          ? trimmed(activity.message) ?? (zh ? '修改待处理' : 'Changes need attention')
          : undefined) ??
        trimmed(withoutSuccessVerdict(input.child?.summaryPreview));
      if (!summary) return { text: zh ? '已完成。' : 'Completed.', tone: 'done' };
      return { text: zh ? `已完成：${summary}` : `Completed: ${summary}`, tone: 'done' };
    }
    case 'failed': {
      const reason =
        (activity?.kind === 'failed' ? trimmed(activity.message) : undefined) ??
        (zh ? '子任务失败' : 'Subtask failed');
      return { text: zh ? `失败：${reason}` : `Failed: ${reason}`, tone: 'failed' };
    }
    case 'cancelled':
      return { text: zh ? '已取消' : 'Cancelled', tone: 'muted' };
  }
}

export function deriveSubagentInlineDetail(input: SubagentInlineInput): SubagentInlineDetail {
  const zh = input.locale === 'zh-CN';
  const usage = input.invocation?.usage;
  const statusLabel = subagentInlineStatusLabel(input.status, input.locale);
  const conclusion = resolveConclusion(input);
  return {
    stepLabel:
      usage !== undefined ? `step ${Math.max(1, usage.toolCalls)} · ${statusLabel}` : statusLabel,
    conclusion: conclusion.text,
    tone: conclusion.tone,
    ...(usage !== undefined
      ? { toolCallsLabel: formatSubagentToolCalls(usage.toolCalls, input.locale) }
      : {}),
    retainedLabel: zh
      ? `保留最近 ${SUBAGENT_INLINE_RECENT_STEPS} 步`
      : `last ${SUBAGENT_INLINE_RECENT_STEPS} steps`,
    openFullLabel: zh ? '打开完整会话 →' : 'Open full session →',
  };
}

/** The tail the inline box keeps; the full session view has the rest. */
export function recentSubagentSteps<T>(
  messages: readonly T[],
  limit: number = SUBAGENT_INLINE_RECENT_STEPS,
): T[] {
  return messages.length <= limit ? [...messages] : messages.slice(messages.length - limit);
}

/**
 * The steps list folds by default (proto shows only the summary), but a live
 * permission gate lives inside it and must never be hidden.
 */
export function shouldShowSubagentSteps(input: {
  userOpen: boolean;
  liveTail?: SubagentStreamState | null | undefined;
}): boolean {
  return input.userOpen || Boolean(input.liveTail?.permissionPrompt);
}
