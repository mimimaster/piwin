/** Pure, provider-truthful metrics for the compact Desktop status bar. */
import { computePromptCacheHitRate, type ContextUsageSnapshot } from '@piwin/contracts';
import { formatUsageDurationMs, formatUsageTokenCount } from './conversation-usage-copy.js';

export type StatusBarMetric = {
  id: 'duration' | 'input' | 'output' | 'cache';
  label: string;
  value: string;
};

const METRIC_LABELS = {
  'zh-CN': {
    duration: '耗时',
    input: '输入',
    output: '输出',
    cache: '缓存',
  },
  en: {
    duration: 'Duration',
    input: 'Input',
    output: 'Output',
    cache: 'Cache',
  },
} as const;

function isReportedNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function formatLiveElapsed(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Build the compact readouts shown beside run state without filling absent fields. */
export function buildStatusBarMetrics(input: {
  usage: ContextUsageSnapshot | null | undefined;
  agentState: 'idle' | 'running' | 'error';
  runStartedAt: number | undefined;
  now: number;
  locale: 'zh-CN' | 'en';
}): StatusBarMetric[] {
  const labels = METRIC_LABELS[input.locale];
  const metrics: StatusBarMetric[] = [];
  const usageUpdatedAt = input.usage ? Date.parse(input.usage.updatedAt) : Number.NaN;
  const usage =
    input.agentState !== 'running' ||
    !isReportedNumber(input.runStartedAt) ||
    (Number.isFinite(usageUpdatedAt) && usageUpdatedAt >= input.runStartedAt)
      ? input.usage
      : undefined;

  if (input.agentState === 'running' && isReportedNumber(input.runStartedAt)) {
    metrics.push({
      id: 'duration',
      label: labels.duration,
      value: formatLiveElapsed(Math.max(0, input.now - input.runStartedAt)),
    });
  } else if (isReportedNumber(usage?.durationMs)) {
    metrics.push({
      id: 'duration',
      label: labels.duration,
      value: formatUsageDurationMs(usage.durationMs),
    });
  }

  const estimatedPrefix = usage?.source === 'host-estimate' ? '~' : '';
  if (isReportedNumber(usage?.promptTokens)) {
    metrics.push({
      id: 'input',
      label: labels.input,
      value: `${estimatedPrefix}${formatUsageTokenCount(usage.promptTokens)}`,
    });
  }
  if (isReportedNumber(usage?.completionTokens)) {
    metrics.push({
      id: 'output',
      label: labels.output,
      value: `${estimatedPrefix}${formatUsageTokenCount(usage.completionTokens)}`,
    });
  }

  const hasCacheAccounting =
    isReportedNumber(usage?.cacheReadTokens) || isReportedNumber(usage?.cacheWriteTokens);
  if (hasCacheAccounting) {
    const rate = computePromptCacheHitRate({
      promptTokens: isReportedNumber(usage?.promptTokens) ? usage.promptTokens : 0,
      cacheReadTokens: isReportedNumber(usage?.cacheReadTokens) ? usage.cacheReadTokens : 0,
      cacheWriteTokens: isReportedNumber(usage?.cacheWriteTokens) ? usage.cacheWriteTokens : 0,
    });
    metrics.push({
      id: 'cache',
      label: labels.cache,
      value: rate === null ? '—' : `${Math.round(rate * 100)}%`,
    });
  }

  return metrics;
}
