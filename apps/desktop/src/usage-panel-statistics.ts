import type {
  UsageBucket,
  UsageCallLog,
  UsageCallLogEntry,
  UsageModelKeyTotal,
  UsageRollup,
} from '@piwin/contracts';
import { computePromptCacheHitRate } from '@piwin/contracts';

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

/** Rolling window for the recent-calls log. The ledger keeps everything; this
 * is only how much of it the live table shows. */
export const RECENT_CALLS_WINDOW_MINUTES = 60;
/** Default page size. Page sizes stay under the Host remote ceiling of 500. */
export const RECENT_CALLS_PAGE_SIZE = 100;
export const RECENT_CALLS_PAGE_SIZES = [50, 100, 200, 500] as const;

export const EMPTY_USAGE_CALL_LOG: UsageCallLog = {
  windowMinutes: RECENT_CALLS_WINDOW_MINUTES,
  from: '',
  to: '',
  entries: [],
  offset: 0,
  limit: RECENT_CALLS_PAGE_SIZE,
  totalInWindow: 0,
  truncated: false,
};

/** Tolerates an older Host that answers with a partial payload. */
export function normalizeUsageCallLog(log: UsageCallLog | undefined): UsageCallLog {
  if (!log || !Array.isArray(log.entries)) {
    return EMPTY_USAGE_CALL_LOG;
  }
  return {
    ...log,
    windowMinutes: log.windowMinutes || RECENT_CALLS_WINDOW_MINUTES,
    offset: log.offset ?? 0,
    limit: log.limit || RECENT_CALLS_PAGE_SIZE,
    totalInWindow: log.totalInWindow ?? log.entries.length,
    truncated: log.truncated ?? false,
  };
}

export type UsageCallLogPage = {
  /** 1-based index of the first row on this page; 0 when the page is empty. */
  firstRow: number;
  /** 1-based index of the last row on this page; 0 when the page is empty. */
  lastRow: number;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Offset to request for the previous page, clamped at 0. */
  previousOffset: number;
  /** Offset to request for the next page. */
  nextOffset: number;
};

/** Page arithmetic for the call-log pager, kept out of the component. */
export function resolveUsageCallLogPage(log: UsageCallLog): UsageCallLogPage {
  const count = log.entries.length;
  const firstRow = count === 0 ? 0 : log.offset + 1;
  const lastRow = count === 0 ? 0 : log.offset + count;
  return {
    firstRow,
    lastRow,
    hasPrevious: log.offset > 0,
    hasNext: lastRow < log.totalInWindow,
    previousOffset: Math.max(0, log.offset - log.limit),
    nextOffset: log.offset + log.limit,
  };
}

export type UsageCallLogSummary = {
  calls: number;
  totalTokens: number;
  cachedCalls: number;
  /** Window-wide hit rate, not the average of per-call rates. */
  cacheHitRate: number | null;
};

export function summarizeUsageCallLog(entries: readonly UsageCallLogEntry[]): UsageCallLogSummary {
  let totalTokens = 0;
  let cachedCalls = 0;
  const totals = { promptTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const entry of entries) {
    totalTokens += entry.totalTokens;
    if (entry.cacheReadTokens > 0) cachedCalls += 1;
    totals.promptTokens += entry.promptTokens;
    totals.cacheReadTokens += entry.cacheReadTokens;
    totals.cacheWriteTokens += entry.cacheWriteTokens;
  }
  return {
    calls: entries.length,
    totalTokens,
    cachedCalls,
    cacheHitRate: computePromptCacheHitRate(totals),
  };
}

/** Wall-clock time of a call, to the second: the log is read as a timeline. */
export function formatUsageClock(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '—';
  }
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatUsageTimestamp(value: string, locale: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '—';
  }
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium' });
}

/** Sub-second calls stay in ms; anything longer reads better in s / m. */
export function formatUsageDuration(durationMs: number | undefined): string {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return '—';
  }
  if (durationMs < 1_000) {
    return `${Math.round(durationMs)}ms`;
  }
  const seconds = durationMs / 1_000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${Math.round(seconds - minutes * 60)}s`;
}

/**
 * Short, stable handle for a session id in a dense table cell.
 * Session ids are UUIDs, so the leading block is the part people recognise
 * (and the part other surfaces print); the full id stays in the cell title.
 */
export function formatUsageSessionTag(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (trimmed.length === 0) {
    return '—';
  }
  return trimmed.length <= 8 ? trimmed : `${trimmed.slice(0, 8)}…`;
}
