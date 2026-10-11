/**
 * Pure formatting for the Host-measured subagent work counters
 * (`SubagentInvocation.usage`). Every helper returns `undefined` when the
 * Host did not send the counters (older Hosts), so callers hide the field
 * instead of showing a made-up zero.
 */
import type { SubagentInvocationUsage } from '@piwin/contracts';

export type SubagentUsageLocale = 'zh-CN' | 'en';

/** Proto `formatTokens`: `830 tok`, `4.2k tok`, `38k tok`. */
export function formatSubagentTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens < 0) return '';
  if (tokens < 1000) return `${Math.round(tokens)} tok`;
  return `${(tokens / 1000).toFixed(tokens >= 10_000 ? 0 : 1)}k tok`;
}

/** Row meta piece: `3 工具` / `3 tools`. */
export function formatSubagentToolCount(count: number, locale: SubagentUsageLocale): string {
  return locale === 'zh-CN' ? `${count} 工具` : `${count} tool${count === 1 ? '' : 's'}`;
}

/** Inline detail line: `3 次工具调用` / `3 tool calls`. */
export function formatSubagentToolCalls(count: number, locale: SubagentUsageLocale): string {
  return locale === 'zh-CN' ? `${count} 次工具调用` : `${count} tool call${count === 1 ? '' : 's'}`;
}

export type SubagentUsageLabels = {
  toolCalls: number;
  totalTokens: number;
  toolsLabel: string;
  /** Absent until the child's first provider request finalized (proto hides 0 tok). */
  tokensLabel?: string;
};

export function subagentUsageLabels(
  usage: SubagentInvocationUsage | undefined,
  locale: SubagentUsageLocale,
): SubagentUsageLabels | undefined {
  if (!usage || !Number.isFinite(usage.toolCalls) || !Number.isFinite(usage.totalTokens)) {
    return undefined;
  }
  const tokensLabel = usage.totalTokens > 0 ? formatSubagentTokens(usage.totalTokens) : '';
  return {
    toolCalls: usage.toolCalls,
    totalTokens: usage.totalTokens,
    toolsLabel: formatSubagentToolCount(usage.toolCalls, locale),
    ...(tokensLabel ? { tokensLabel } : {}),
  };
}

/**
 * Group header total (proto ②: `9 工具 · 18k tok`). Only when every row has
 * Host counters — a partial sum would understate the group.
 */
export function sumSubagentUsageLabel(
  rows: ReadonlyArray<{ toolCalls?: number; totalTokens?: number }>,
  locale: SubagentUsageLocale,
): string | undefined {
  if (rows.length === 0) return undefined;
  let tools = 0;
  let tokens = 0;
  for (const row of rows) {
    if (row.toolCalls === undefined || row.totalTokens === undefined) return undefined;
    tools += row.toolCalls;
    tokens += row.totalTokens;
  }
  const parts = [formatSubagentToolCount(tools, locale)];
  if (tokens > 0) parts.push(formatSubagentTokens(tokens));
  return parts.join(' · ');
}
