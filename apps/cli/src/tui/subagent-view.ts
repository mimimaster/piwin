import type { SelectItem } from '@earendil-works/pi-tui';
import type { SessionSummary, SubagentResultSummary } from '@piwin/contracts';

/**
 * Child sessions and their frozen results, as the TUI lists them. Pure — the
 * Host decides what may be done with a result (`availability`).
 */

export type SubagentChild = Pick<SessionSummary, 'name' | 'subagentStatus' | 'subagentTaskId'> & {
  sessionId: string;
};

export type ResultAction =
  | 'files'
  | 'apply'
  | 'resolve'
  | 'retain'
  | 'discard'
  | 'continue'
  | 'open-child'
  | 'close';

const CHILD_STATUS: Record<NonNullable<SessionSummary['subagentStatus']>, string> = {
  running: '运行中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const INTEGRATION: Record<SubagentResultSummary['integrationStatus'], string | undefined> = {
  'not-requested': undefined,
  pending: '待处理',
  applied: '已应用',
  conflict: '有冲突',
  failed: '应用失败',
  retained: '已保留',
  discarded: '已丢弃',
};

/** The remote projection names the id `sessionId`; the local shape names it `id`. */
export function toSubagentChild(summary: SessionSummary & { sessionId?: string }): SubagentChild {
  return {
    sessionId: summary.sessionId ?? summary.id,
    ...(summary.name === undefined ? {} : { name: summary.name }),
    ...(summary.subagentStatus === undefined ? {} : { subagentStatus: summary.subagentStatus }),
    ...(summary.subagentTaskId === undefined ? {} : { subagentTaskId: summary.subagentTaskId }),
  };
}

export function childLabel(child: SubagentChild | undefined, fallback: string): string {
  return child?.name ?? child?.subagentTaskId ?? fallback;
}

/** Status-line part: only what still needs attention. */
export function describeSubagents(
  children: readonly SubagentChild[],
  results: readonly SubagentResultSummary[],
): string | undefined {
  const running = children.filter((child) => child.subagentStatus === 'running').length;
  const pending = results.filter(needsDecision).length;
  const parts = [running > 0 ? `子代理 ${running} 运行中` : undefined, pending > 0 ? `${pending} 个结果待处理` : undefined];
  const text = parts.filter((part): part is string => part !== undefined).join(' · ');
  return text.length === 0 ? undefined : text;
}

/** A result whose changes are neither in the workspace nor explicitly set aside. */
export function needsDecision(result: SubagentResultSummary): boolean {
  return (
    result.childChanges !== null &&
    (result.integrationStatus === 'pending' ||
      result.integrationStatus === 'conflict' ||
      result.integrationStatus === 'failed')
  );
}

/** One row per child, with its result state when it has one. */
export function subagentItems(
  children: readonly SubagentChild[],
  results: readonly SubagentResultSummary[],
): SelectItem[] {
  return children.map((child) => {
    const result = latestResultFor(child.sessionId, results);
    const state = [
      child.subagentStatus === undefined ? undefined : CHILD_STATUS[child.subagentStatus],
      result === undefined ? undefined : INTEGRATION[result.integrationStatus],
      result?.reviewStatus === 'changes-requested' ? '评审要求修改' : undefined,
      result?.reviewStatus === 'approved' ? '评审通过' : undefined,
    ].filter((part): part is string => part !== undefined);
    return {
      value: child.sessionId,
      label: childLabel(child, child.sessionId),
      ...(state.length === 0 ? {} : { description: state.join(' · ') }),
    };
  });
}

export function latestResultFor(
  childSessionId: string,
  results: readonly SubagentResultSummary[],
): SubagentResultSummary | undefined {
  return results
    .filter((result) => result.childSessionId === childSessionId)
    .sort((left, right) => (right.candidateGeneration ?? 0) - (left.candidateGeneration ?? 0) || right.revision - left.revision)[0];
}

/**
 * What can be done with a child now. Actions the Host refuses are listed
 * with its reason rather than hidden, so "why can't I apply this" has an answer.
 */
export function childActionItems(
  result: SubagentResultSummary | undefined,
  canOpenChild: boolean,
  childStatus?: SubagentChild['subagentStatus'],
): SelectItem[] {
  const items: SelectItem[] = [];
  const gated = (action: ResultAction, label: string, allowed: boolean, reason: string | undefined, hint?: string): void => {
    if (allowed) items.push({ value: action, label, ...(hint === undefined ? {} : { description: hint }) });
    else if (reason !== undefined) items.push({ value: 'close', label: `${label}（不可用）`, description: reason });
  };
  if (result !== undefined) {
    const { availability } = result;
    gated('files', '查看改动的文件', availability.view.allowed, availability.view.reason);
    gated('apply', '应用到工作区', availability.apply.allowed, availability.apply.reason, '把这份改动合进当前项目');
    gated('resolve', '让主会话处理冲突', availability.resolve.allowed, availability.resolve.reason);
    if (needsDecision(result)) items.push({ value: 'retain', label: '先保留，不应用', description: '改动留在子代理的副本里' });
    gated('discard', '丢弃副本', availability.cleanup.allowed, availability.cleanup.reason, '删除子代理的工作副本');
  }
  // A running child takes instructions from its parent turn, not from the side.
  if (childStatus !== undefined && childStatus !== 'running') {
    items.push({ value: 'continue', label: '给它追加指令', description: '让这个子代理接着做' });
  }
  if (canOpenChild) items.push({ value: 'open-child', label: '打开子代理的对话' });
  items.push({ value: 'close', label: '关闭' });
  return items;
}

/**
 * A line for the transcript when a child ends. Same-child updates are
 * projections, so a follow-up this shell sent can settle without a visible
 * `running` in between; the caller says when one was outstanding.
 */
export function describeChildChange(
  previous: SubagentChild | undefined,
  next: SubagentChild,
  followUpSettled = false,
): string | undefined {
  const before = previous?.subagentStatus;
  const after = next.subagentStatus;
  if (after === undefined || after === 'running') return undefined;
  if (after === before && !followUpSettled) return undefined;
  return `子代理「${childLabel(next, next.sessionId)}」${CHILD_STATUS[after]} · /subagents 查看`;
}
