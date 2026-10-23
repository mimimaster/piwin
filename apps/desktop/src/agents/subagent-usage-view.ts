/**
 * Pure formatting for the Host-measured subagent work counters
 * (`SubagentInvocation.usage`). Every helper returns `undefined` when the
 * Host did not send the counters (older Hosts), so callers hide the field
 * instead of showing a made-up zero.
 */
import type { SubagentInvocationUsage } from '@piwin/contracts';
import {
  formatSubagentTokens,
  formatSubagentToolCount,
  type SubagentTextLocale,
} from '@piwin/host-client';

export { formatSubagentTokens, formatSubagentToolCalls, formatSubagentToolCount } from '@piwin/host-client';

export type SubagentUsageLocale = SubagentTextLocale;

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
