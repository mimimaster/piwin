/**
 * Conversation-facing occupancy and last-request copy.
 * Occupancy and last-request metering stay separate; no invented category split.
 */
import type { AssistantUsageMeasurement } from '@piwin/contracts';

export type ConversationUsageLocale = 'zh-CN' | 'en';

export type ConversationUsageDetailRow = {
  id: string;
  label: string;
  value: string;
};

export type ContextUsageCopy = {
  title: string;
  close: string;
  settings: string;
  occupied: string;
  limit: string;
  remaining: string;
  confirmed: string;
  lastConfirmedPending: string;
  pendingMeasurement: string;
  estimated: string;
  realtimeEstimate: string;
  exceedsLimit: string;
  limitUnknown: string;
  estimatedAgainstSelectedModel: string;
  compacting: string;
  compactedPending: string;
  offline: string;
  capabilityMissing: string;
  lastRequest: string;
  input: string;
  cacheRead: string;
  cacheWrite: string;
  output: string;
  total: string;
  duration: string;
  accessibleLabel: (used: string, limit: string, percent: string | undefined) => string;
  hover: (used: string, limit: string, percent: string | undefined) => string;
  percentFull: (percent: number) => string;
};

const COPY: Record<ConversationUsageLocale, ContextUsageCopy> = {
  'zh-CN': {
    title: '上下文占用',
    close: '关闭',
    settings: '编辑上下文窗口',
    occupied: '上下文占用',
    limit: '上下文上限',
    remaining: '剩余',
    confirmed: '已确认',
    lastConfirmedPending: '上次确认，当前上下文待测量',
    pendingMeasurement: '当前上下文待测量',
    estimated: '估算',
    realtimeEstimate: '实时估算',
    exceedsLimit: '超过上下文上限',
    limitUnknown: '上限未知',
    estimatedAgainstSelectedModel: '按所选模型窗口估算',
    compacting: '压缩中',
    compactedPending: '上下文已压缩，用量待更新',
    offline: '离线，显示上次数据',
    capabilityMissing: '当前主机不支持实时上下文占用',
    lastRequest: '最后一次请求',
    input: '输入',
    cacheRead: '缓存读取',
    cacheWrite: '缓存写入',
    output: '输出',
    total: '合计',
    duration: '耗时',
    accessibleLabel: (used, limit, percent) =>
      percent
        ? `上下文占用 ${used} / ${limit}（${percent}）`
        : `上下文占用 ${used}，${limit}`,
    hover: (used, limit, percent) =>
      percent ? `${percent}（${used} / ${limit}）上下文已占用` : `${used} / ${limit} 上下文已占用`,
    percentFull: (percent) => `${percent}% 已占用`,
  },
  en: {
    title: 'Context usage',
    close: 'Close',
    settings: 'Edit context window',
    occupied: 'Context occupied',
    limit: 'Context limit',
    remaining: 'Remaining',
    confirmed: 'Confirmed',
    lastConfirmedPending: 'Last confirmed; current context pending measurement',
    pendingMeasurement: 'Current context pending measurement',
    estimated: 'Estimated',
    realtimeEstimate: 'Realtime estimate',
    exceedsLimit: 'Exceeds context limit',
    limitUnknown: 'Limit unknown',
    estimatedAgainstSelectedModel: 'Estimated against selected model window',
    compacting: 'Compacting',
    compactedPending: 'Context compacted, usage pending',
    offline: 'Offline, showing last data',
    capabilityMissing: 'This Host does not support realtime context usage',
    lastRequest: 'Last request',
    input: 'Input',
    cacheRead: 'Cache read',
    cacheWrite: 'Cache write',
    output: 'Output',
    total: 'Total',
    duration: 'Duration',
    accessibleLabel: (used, limit, percent) =>
      percent ? `Context ${used} / ${limit} (${percent})` : `Context ${used}, ${limit}`,
    hover: (used, limit, percent) =>
      percent
        ? `${percent} (${used} / ${limit}) context used`
        : `${used} / ${limit} context used`,
    percentFull: (percent) => `${percent}% full`,
  },
};

export function getContextUsageCopy(locale: ConversationUsageLocale): ContextUsageCopy {
  return COPY[locale];
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
  return COPY[locale].estimated;
}

export function conversationUsageConfirmedLabel(
  locale: ConversationUsageLocale = 'en',
): string {
  return COPY[locale].confirmed;
}

export function buildOccupancyDetailRows(input: {
  used?: number;
  limit?: number;
  locale?: ConversationUsageLocale;
  remaining?: number;
}): ConversationUsageDetailRow[] {
  const locale = input.locale ?? 'en';
  const labels = COPY[locale];
  const rows: ConversationUsageDetailRow[] = [];
  if (typeof input.used === 'number') {
    rows.push({
      id: 'occupied',
      label: labels.occupied,
      value: formatUsageTokenCount(input.used),
    });
  }
  rows.push({
    id: 'limit',
    label: labels.limit,
    value:
      typeof input.limit === 'number' ? formatUsageTokenCount(input.limit) : labels.limitUnknown,
  });
  if (typeof input.remaining === 'number') {
    rows.push({
      id: 'remaining',
      label: labels.remaining,
      value: formatUsageTokenCount(input.remaining),
    });
  }
  return rows;
}

export function buildLastRequestDetailRows(input: {
  usage: AssistantUsageMeasurement | null | undefined;
  locale?: ConversationUsageLocale;
}): ConversationUsageDetailRow[] {
  const usage = input.usage;
  if (!usage) {
    return [];
  }
  const locale = input.locale ?? 'en';
  const labels = COPY[locale];
  const rows: ConversationUsageDetailRow[] = [];
  if (typeof usage.promptTokens === 'number') {
    rows.push({
      id: 'input',
      label: labels.input,
      value: formatUsageTokenCount(usage.promptTokens),
    });
  }
  if (typeof usage.cacheReadTokens === 'number') {
    rows.push({
      id: 'cache-read',
      label: labels.cacheRead,
      value: formatUsageTokenCount(usage.cacheReadTokens),
    });
  }
  if (typeof usage.cacheWriteTokens === 'number') {
    rows.push({
      id: 'cache-write',
      label: labels.cacheWrite,
      value: formatUsageTokenCount(usage.cacheWriteTokens),
    });
  }
  if (typeof usage.completionTokens === 'number') {
    rows.push({
      id: 'output',
      label: labels.output,
      value: formatUsageTokenCount(usage.completionTokens),
    });
  }
  if (typeof usage.totalTokens === 'number') {
    rows.push({
      id: 'total',
      label: labels.total,
      value: formatUsageTokenCount(usage.totalTokens),
    });
  }
  if (typeof usage.durationMs === 'number') {
    rows.push({
      id: 'duration',
      label: labels.duration,
      value: formatUsageDurationMs(usage.durationMs),
    });
  }
  return rows;
}

/** @deprecated Use buildOccupancyDetailRows + buildLastRequestDetailRows. */
export function buildConversationUsageDetailRows(input: {
  usage?: { promptTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; completionTokens?: number; totalTokens?: number; durationMs?: number } | null;
  used: number;
  limit: number;
  locale?: ConversationUsageLocale;
}): ConversationUsageDetailRow[] {
  const occupancy = buildOccupancyDetailRows({
    used: input.used,
    limit: input.limit,
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
  });
  if (!input.usage) {
    return occupancy;
  }
  return [
    ...occupancy,
    ...buildLastRequestDetailRows({
      usage: {
        measurementId: 'legacy',
        sessionId: 'legacy',
        messageId: 'legacy',
        totalTokens: input.usage.totalTokens ?? 0,
        recordedAt: '1970-01-01T00:00:00.000Z',
        ...(typeof input.usage.promptTokens === 'number'
          ? { promptTokens: input.usage.promptTokens }
          : {}),
        ...(typeof input.usage.cacheReadTokens === 'number'
          ? { cacheReadTokens: input.usage.cacheReadTokens }
          : {}),
        ...(typeof input.usage.cacheWriteTokens === 'number'
          ? { cacheWriteTokens: input.usage.cacheWriteTokens }
          : {}),
        ...(typeof input.usage.completionTokens === 'number'
          ? { completionTokens: input.usage.completionTokens }
          : {}),
        ...(typeof input.usage.durationMs === 'number'
          ? { durationMs: input.usage.durationMs }
          : {}),
      },
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
    }),
  ];
}

export function isHostEstimatedUsage(usage: { source?: string } | null | undefined): boolean {
  return usage?.source === 'host-estimate';
}

const LATIN_IN_ZH = /[A-Za-z]{3,}/;

export function contextUsageCopyHasMixedEnglish(locale: ConversationUsageLocale): boolean {
  if (locale !== 'zh-CN') {
    return false;
  }
  const copy = COPY['zh-CN'];
  const samples = [
    copy.title,
    copy.close,
    copy.settings,
    copy.occupied,
    copy.limit,
    copy.remaining,
    copy.confirmed,
    copy.lastConfirmedPending,
    copy.pendingMeasurement,
    copy.estimated,
    copy.realtimeEstimate,
    copy.exceedsLimit,
    copy.limitUnknown,
    copy.estimatedAgainstSelectedModel,
    copy.compacting,
    copy.compactedPending,
    copy.offline,
    copy.capabilityMissing,
    copy.lastRequest,
    copy.input,
    copy.cacheRead,
    copy.cacheWrite,
    copy.output,
    copy.total,
    copy.duration,
    copy.percentFull(12),
  ];
  return samples.some((sample) => LATIN_IN_ZH.test(sample));
}
