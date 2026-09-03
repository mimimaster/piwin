/**
 * Compaction projected onto the agent's tool chain.
 *
 * Context compaction is work the agent performed, not a notification about the
 * app, so it is mapped onto the same `ToolCardUi` shape the transcript already
 * renders for every tool call. Keeping the projection pure means head copy,
 * token delta, and terminal semantics stay unit-testable while the rendering
 * layer needs no compaction-specific chrome.
 */
import type { ToolPresentation } from '@piwin/contracts';
import type { CompactionActivityUi, ToolCardUi } from './chat-reducer.js';
import { formatUsageTokenCount } from './conversation-usage-copy.js';

/** Synthetic tool identity for compaction rows; no model ever invokes it. */
export const COMPACTION_TOOL_NAME = 'piwin_compact';

/** Same bound the transcript applies to real tool output bodies. */
const MAX_COMPACTION_BODY_CHARS = 8_000;

export type CompactionRowLocale = 'zh-CN' | 'en';

export function mapCompactionActivityToToolRow(
  activity: CompactionActivityUi,
  locale: CompactionRowLocale,
): ToolCardUi {
  const isZh = locale === 'zh-CN';
  const durationMs = resolveCompactionDurationMs(activity);
  const summaryBody = activity.summary?.trim()
    ? activity.summary.trim().slice(0, MAX_COMPACTION_BODY_CHARS)
    : '';
  const failureMessage = activity.message?.trim()
    ? activity.message.trim()
    : isZh
      ? '上下文整理失败'
      : 'Compaction failed';

  const presentation: ToolPresentation = {
    kind: 'other',
    title: isZh ? '上下文整理' : 'Context compaction',
    actionVerb: resolveCompactionActionVerb(activity.phase, isZh),
    summary: resolveCompactionHeadSummary(activity),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(summaryBody ? { output: { text: summaryBody } } : {}),
    ...(activity.phase === 'failed'
      ? { error: { category: 'execution' as const, message: failureMessage } }
      : {}),
  };

  return {
    toolCallId: activity.operationId,
    toolName: COMPACTION_TOOL_NAME,
    status: resolveCompactionToolStatus(activity.phase),
    output: summaryBody,
    presentation,
    ...(activity.runId !== undefined ? { runId: activity.runId } : {}),
  };
}

/**
 * Cancelled compaction is a settled outcome, not a failure: the prior context
 * is still intact, so it must not inherit the error treatment.
 */
export function resolveCompactionToolStatus(
  phase: CompactionActivityUi['phase'],
): ToolCardUi['status'] {
  switch (phase) {
    case 'running':
      return 'running';
    case 'failed':
      return 'error';
    case 'succeeded':
    case 'cancelled':
      return 'done';
  }
}

/**
 * The failed phase returns the bare action because the tool-call head appends
 * its own localized "failed" suffix to error rows.
 */
function resolveCompactionActionVerb(
  phase: CompactionActivityUi['phase'],
  isZh: boolean,
): string {
  switch (phase) {
    case 'running':
      return isZh ? '整理上下文' : 'Compacting context';
    case 'succeeded':
      return isZh ? '已整理上下文' : 'Compacted context';
    case 'cancelled':
      return isZh ? '已取消整理上下文' : 'Compaction cancelled';
    case 'failed':
      return isZh ? '整理上下文' : 'Compact context';
  }
}

/**
 * Collapsed head detail. The token delta is the only number worth the row; the
 * host's prose ("Context compacted") only repeats the action verb, and a
 * failure reason already renders in the error body.
 */
function resolveCompactionHeadSummary(activity: CompactionActivityUi): string {
  if (activity.phase === 'running' || activity.phase === 'failed') {
    return '';
  }
  const { tokensBefore, tokensAfter } = activity;
  if (tokensBefore !== undefined && tokensAfter !== undefined) {
    return `${formatUsageTokenCount(tokensBefore)} → ${formatUsageTokenCount(tokensAfter)} tokens`;
  }
  if (tokensAfter !== undefined) {
    return `${formatUsageTokenCount(tokensAfter)} tokens`;
  }
  return '';
}

function resolveCompactionDurationMs(activity: CompactionActivityUi): number | undefined {
  if (typeof activity.durationMs === 'number') {
    return Math.max(0, Math.round(activity.durationMs));
  }
  if (activity.endedAt !== undefined) {
    return Math.max(0, Math.round(activity.endedAt - activity.startedAt));
  }
  return undefined;
}