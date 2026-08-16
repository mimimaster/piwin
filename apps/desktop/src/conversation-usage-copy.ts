/**
 * Conversation-facing usage copy. Reuses ContextUsageSnapshot fields without
 * inventing per-message totals or mixing occupancy with cumulative spend.
 */
import type { ContextUsageSnapshot } from '@piwin/contracts';

export type ConversationUsageLocale = 'zh-CN' | 'en';

export type ConversationUsageDetailRow = {
  id: string;
  label: string;
  value: string;
};

const LABELS = {
  'zh-CN': {
    occupied: '上下文占用',
    limit: '上下文上限',
    input: '输入',
    cacheRead: '缓存读取',
    cacheWrite: '缓存写入',
    output: '输出',
    total: '合计',
    duration: '耗时',
    estimated: '估算',
  },
  en: {
    occupied: 'Context occupied',
    limit: 'Context limit',
    input: 'Input',
    cacheRead: 'Cache read',
    cacheWrite: 'Cache write',
    output: 'Output',
    total: 'Total',
    duration: 'Duration',
    estimated: 'Estimated',
  },
} as const;

export function isHostEstimatedUsage(
  usage: ContextUsageSnapshot | null | undefined,
): boolean {
  return usage?.source === 'host-estimate';
}

export function formatUsageTokenCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions % 1 === 0 ? millions : millions.toFixed(1)}M`;
  }
  if (value >= 10_000) {
    return `${Math.round(value / 1000)}K`;
  }
  if (value >= 1000) {
    const thousands = value / 1000;
    return `${thousands % 1 === 0 ? thousands : thousands.toFixed(1)}K`;
  }
  return value.toLocaleString();
}

export function formatContextOccupancyCopy(used: number, limit: number): string {
  return `${formatUsageTokenCount(used)} / ${formatUsageTokenCount(limit)}`;
}

export function formatUsageDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${Math.round(durationMs)}ms`;
  }
  const seconds = durationMs / 1000;
  return `${seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
}

export function conversationUsageEstimatedLabel(
  locale: ConversationUsageLocale = 'en',
): string {
  return LABELS[locale].estimated;
}

/**
 * Status / popover rows for Conversation. Occupancy and limit always appear
 * once a sample exists; last-turn fields are omitted until Host reports them.
 */
export function buildConversationUsageDetailRows(input: {
  usage: ContextUsageSnapshot | null | undefined;
  used: number;
  limit: number;
  locale?: ConversationUsageLocale;
}): ConversationUsageDetailRow[] {
  const locale = input.locale ?? 'en';
  const labels = LABELS[locale];
  const estimated = isHostEstimatedUsage(input.usage);
  const mark = (value: string): string => (estimated ? `~${value}` : value);
  const rows: ConversationUsageDetailRow[] = [
    {
      id: 'occupied',
      label: labels.occupied,
      value: mark(formatUsageTokenCount(input.used)),
    },
    {
      id: 'limit',
      label: labels.limit,
      value: formatUsageTokenCount(input.limit),
    },
  ];

  const usage = input.usage;
  if (typeof usage?.promptTokens === 'number') {
    rows.push({
      id: 'input',
      label: labels.input,
      value: mark(formatUsageTokenCount(usage.promptTokens)),
    });
  }
  if (typeof usage?.cacheReadTokens === 'number') {
    rows.push({
      id: 'cache-read',
      label: labels.cacheRead,
      value: mark(formatUsageTokenCount(usage.cacheReadTokens)),
    });
  }
  if (typeof usage?.cacheWriteTokens === 'number') {
    rows.push({
      id: 'cache-write',
      label: labels.cacheWrite,
      value: mark(formatUsageTokenCount(usage.cacheWriteTokens)),
    });
  }
  if (typeof usage?.completionTokens === 'number') {
    rows.push({
      id: 'output',
      label: labels.output,
      value: mark(formatUsageTokenCount(usage.completionTokens)),
    });
  }
  if (typeof usage?.totalTokens === 'number') {
    rows.push({
      id: 'total',
      label: labels.total,
      value: mark(formatUsageTokenCount(usage.totalTokens)),
    });
  }
  if (typeof usage?.durationMs === 'number') {
    rows.push({
      id: 'duration',
      label: labels.duration,
      value: formatUsageDurationMs(usage.durationMs),
    });
  }

  return rows;
}
