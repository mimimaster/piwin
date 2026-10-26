/**
 * Shared status-bar metrics for the CLI status line and the Desktop composer
 * bar: first-token latency, speed, session turns, tokens, cache, cost and context.
 * Pure; each shell decides which of these to draw for its width.
 */
import { computePromptCacheHitRate, computeTokensPerSecond, type SessionUsageTotals, type UsageReasoningTiming } from './usage.js';

export type StatusTone = 'ok' | 'warn' | 'critical';
export type StatusTier = 'wide' | 'medium' | 'narrow';

export type StatusRequestTiming = {
  promptTokens?: number | undefined;
  cacheReadTokens?: number | undefined;
  cacheWriteTokens?: number | undefined;
  completionTokens?: number | undefined;
  durationMs?: number | undefined;
  firstTokenMs?: number | undefined;
  reasoningTokens?: number | undefined;
  firstTokenKind?: UsageReasoningTiming['firstTokenKind'] | undefined;
};

export type StatusContextInput = { used: number; limit: number; estimated?: boolean };

export type StatusMetricsInput = {
  totals?: SessionUsageTotals | null | undefined;
  /** The newest request seen live (usage/update); wins over the totals copy. */
  lastRequest?: StatusRequestTiming | null | undefined;
  context?: { tokensUsed?: number; tokensLimit?: number; estimated?: boolean } | null | undefined;
};

export type StatusContextMetric = { used: number; limit: number; ratio: number; estimated: boolean; tone: StatusTone };

export type StatusMetrics = {
  ttftMs?: number;
  ttftTone?: StatusTone;
  tokensPerSecond?: number;
  lastDurationMs?: number;
  /** User turns in the session; omitted while zero. */
  userTurnCount?: number;
  /** All input incl. cache reads/writes. */
  inputTokens?: number;
  outputTokens?: number;
  /** Prompt-cache hit rate of the latest request (not the session average). */
  cacheHitRate?: number;
  /** Only when the Host priced at least one request. */
  costUsd?: number;
  context?: StatusContextMetric;
};

export const STATUS_WIDE_MIN = 120;
export const STATUS_MEDIUM_MIN = 80;

export function pickStatusTier(width: number): StatusTier {
  return width >= STATUS_WIDE_MIN ? 'wide' : width >= STATUS_MEDIUM_MIN ? 'medium' : 'narrow';
}

export function contextTone(ratio: number): StatusTone {
  return ratio >= 0.9 ? 'critical' : ratio >= 0.7 ? 'warn' : 'ok';
}

export function ttftTone(ms: number): StatusTone {
  return ms > 5000 ? 'critical' : ms > 2000 ? 'warn' : 'ok';
}

export function formatCompactTokens(value: number): string {
  const n = Math.max(0, value);
  if (n >= 1_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

export function formatStatusSeconds(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 10) return `${seconds.toFixed(2)}s`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}m${String(whole % 60).padStart(2, '0')}s`;
}

export function formatStatusUsd(usd: number): string {
  return usd < 0.01 ? '<$0.01' : `$${usd.toFixed(2)}`;
}

export function contextBar(ratio: number, cells = 6): string {
  const filled = Math.max(0, Math.min(cells, Math.round(Math.max(0, ratio) * cells)));
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled);
}

function trimZero(text: string): string {
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function buildStatusMetrics(input: StatusMetricsInput): StatusMetrics {
  const metrics: StatusMetrics = {};
  const totals = input.totals ?? undefined;
  const request = input.lastRequest ?? totals?.latestRequest;
  if (request) {
    if (finite(request.firstTokenMs)) {
      metrics.ttftMs = request.firstTokenMs;
      metrics.ttftTone = ttftTone(request.firstTokenMs);
    }
    if (finite(request.durationMs) && request.durationMs > 0) metrics.lastDurationMs = request.durationMs;
    if (finite(request.completionTokens)) {
      const speed = computeTokensPerSecond({
        completionTokens: request.completionTokens,
        ...(request.durationMs !== undefined ? { durationMs: request.durationMs } : {}),
        ...(request.firstTokenMs !== undefined ? { firstTokenMs: request.firstTokenMs } : {}),
        ...(request.reasoningTokens !== undefined ? { reasoningTokens: request.reasoningTokens } : {}),
        ...(request.firstTokenKind !== undefined ? { firstTokenKind: request.firstTokenKind } : {}),
      });
      if (speed !== null) metrics.tokensPerSecond = speed;
    }
    // The latest request shows whether the cache holds right now; a session
    // average hides a miss behind earlier hits.
    if (finite(request.promptTokens) || finite(request.cacheReadTokens) || finite(request.cacheWriteTokens)) {
      const hit = computePromptCacheHitRate({
        promptTokens: finite(request.promptTokens) ? request.promptTokens : 0,
        cacheReadTokens: finite(request.cacheReadTokens) ? request.cacheReadTokens : 0,
        cacheWriteTokens: finite(request.cacheWriteTokens) ? request.cacheWriteTokens : 0,
      });
      if (hit !== null) metrics.cacheHitRate = hit;
    }
  }
  if (totals && totals.entryCount > 0) {
    if (totals.userTurnCount > 0) metrics.userTurnCount = totals.userTurnCount;
    metrics.inputTokens = totals.promptTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
    metrics.outputTokens = totals.completionTokens;
    if (finite(totals.estimatedCostUsd) && (totals.pricedEntryCount ?? 1) > 0) metrics.costUsd = totals.estimatedCostUsd;
  }
  const context = input.context;
  if (context && finite(context.tokensUsed) && finite(context.tokensLimit) && context.tokensLimit > 0) {
    const ratio = context.tokensUsed / context.tokensLimit;
    metrics.context = {
      used: context.tokensUsed, limit: context.tokensLimit, ratio,
      estimated: context.estimated === true, tone: contextTone(ratio),
    };
  }
  return metrics;
}
