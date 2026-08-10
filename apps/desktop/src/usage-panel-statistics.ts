import type { UsageBucket, UsageModelKeyTotal, UsageRollup } from '@piwin/contracts';

export type UsageTimeRange = '7d' | '30d' | '90d' | 'all';

type CompatibleUsageRollup = Omit<UsageRollup, 'byModelKey'> & {
  byModelKey?: UsageModelKeyTotal[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const EMPTY_USAGE_ROLLUP: UsageRollup = {
  scope: { kind: 'global' },
  promptTokens: 0,
  completionTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 0,
  entryCount: 0,
  sessionCount: 0,
  firstAt: null,
  lastAt: null,
  byModel: {},
  byModelKey: [],
  byDay: {},
  bySession: [],
};

export function resolveUsageWindow(range: UsageTimeRange): { from: string } | undefined {
  if (range === 'all') {
    return undefined;
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return { from: new Date(Date.now() - days * DAY_MS).toISOString() };
}

export function formatUsageCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 1 : 2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}k`;
  }
  return String(value);
}

export function formatUsageExact(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatUsagePercent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

export function formatTokensPerSecond(rate: number | null): string {
  return rate === null ? '—' : `${rate.toFixed(rate >= 100 ? 0 : 1)} tok/s`;
}

export function formatUsageDate(value: string | null, locale: string): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '—';
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export function tokenComponents(bucket: UsageBucket): number {
  return (
    bucket.promptTokens + bucket.completionTokens + bucket.cacheReadTokens + bucket.cacheWriteTokens
  );
}

export function deriveLegacyModelKeyRows(
  byModel: Record<string, UsageBucket>,
): UsageModelKeyTotal[] {
  return Object.entries(byModel)
    .map(([modelId, bucket]) => ({
      providerId: null,
      modelId,
      promptTokens: bucket.promptTokens,
      completionTokens: bucket.completionTokens,
      cacheReadTokens: bucket.cacheReadTokens ?? 0,
      cacheWriteTokens: bucket.cacheWriteTokens ?? 0,
      totalTokens: bucket.totalTokens,
      entryCount: bucket.entryCount,
      ...(bucket.durationMs !== undefined ? { durationMs: bucket.durationMs } : {}),
      ...(bucket.firstTokenMs !== undefined ? { firstTokenMs: bucket.firstTokenMs } : {}),
      ...(bucket.successCount !== undefined ? { successCount: bucket.successCount } : {}),
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens);
}

/** Keeps the Desktop compatible with an older Host that has no byModelKey. */
export function normalizeUsageRollup(rollup: CompatibleUsageRollup | undefined): UsageRollup {
  if (!rollup) {
    return EMPTY_USAGE_ROLLUP;
  }
  return {
    ...rollup,
    cacheReadTokens: rollup.cacheReadTokens ?? 0,
    cacheWriteTokens: rollup.cacheWriteTokens ?? 0,
    byModelKey: Array.isArray(rollup.byModelKey)
      ? rollup.byModelKey
      : deriveLegacyModelKeyRows(rollup.byModel),
  };
}
