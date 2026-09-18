/**
 * Token / context usage contracts (CE-OBS).
 * Host maps Pi `contextUsage` / assistant usage → `AgentEvent` `usage/update`.
 */

import type { SessionScope, ThinkingLevel } from './host.js';

export type UsageSource = 'pi-contextUsage' | 'assistant-usage' | 'host-estimate';

/**
 * Optional category breakdown for context ring popover.
 * Values are token estimates when known; omitted categories render as unknown.
 */
export type ContextUsageBreakdown = {
  systemPromptTokens?: number;
  toolDefinitionsTokens?: number;
  rulesTokens?: number;
  skillsTokens?: number;
  mcpTokens?: number;
  conversationTokens?: number;
  /** How the breakdown was produced when not from the model. */
  source?: 'pi' | 'host-estimate';
};

/** Snapshot of context window and last-turn token accounting. */
export type ContextUsageSnapshot = {
  sessionId: string;
  /** Model id reported by Pi for this usage sample when available. */
  modelId?: string;
  /** Thinking effort configured for the turn when known. */
  thinkingLevel?: ThinkingLevel;
  /** Tokens currently occupying the model context when known. */
  tokensUsed?: number;
  /** Model context window size when known. */
  tokensLimit?: number;
  promptTokens?: number;
  completionTokens?: number;
  /** Input tokens served from the provider prompt cache. */
  cacheReadTokens?: number;
  /** Input tokens written to the provider prompt cache. */
  cacheWriteTokens?: number;
  totalTokens?: number;
  /** Generation duration in milliseconds when reported. */
  durationMs?: number;
  /** First token latency in milliseconds when reported. */
  firstTokenMs?: number;
  /** 0–1 fraction of context used when computable. */
  contextRatio?: number;
  updatedAt: string;
  source?: UsageSource;
  /** Category split for UI ring details (optional). */
  breakdown?: ContextUsageBreakdown;
};

/**
 * Decide whether an incoming usage snapshot may replace the current one.
 *
 * Host estimates are only a fallback for adapters that do not report usage.
 * They must never replace provider/Pi measurements, regardless of event order.
 */
export function shouldAcceptContextUsage(
  current: ContextUsageSnapshot | null | undefined,
  incoming: ContextUsageSnapshot,
): boolean {
  if (!current) {
    return true;
  }
  return current.source === 'host-estimate' || incoming.source !== 'host-estimate';
}

/**
 * One billable turn recorded in the usage ledger (CE-OBS).
 * Only assistant-usage (agent_end) and host-estimate entries are recorded;
 * `pi-contextUsage` snapshots are cumulative context occupancy and never summable.
 */
export type UsageRecord = {
  sessionId: string;
  /** Project path when the session is project-scoped; null for general sessions. */
  projectPath: string | null;
  /**
   * Provider configuration used for the turn. A provider configuration owns
   * one credential source, so this is the safe, non-secret Key dimension for
   * usage attribution. The API key value is never stored in the ledger.
   */
  providerId?: string;
  /** Model used for the turn when known. */
  modelId?: string;
  /** Thinking effort configured for the turn when known. */
  thinkingLevel?: ThinkingLevel;
  promptTokens?: number;
  completionTokens?: number;
  /** Input tokens served from the provider prompt cache. */
  cacheReadTokens?: number;
  /** Input tokens written to the provider prompt cache. */
  cacheWriteTokens?: number;
  /** Provider-reported total; includes cache tokens when the provider reports them. */
  totalTokens: number;
  source: 'assistant-usage' | 'host-estimate';
  /** ISO timestamp of the turn. */
  recordedAt: string;
  /** Generation duration in milliseconds when known. */
  durationMs?: number;
  /** First token latency in milliseconds when known. */
  firstTokenMs?: number;
  /** Turn outcome status. */
  success?: boolean;
  measurementId?: string;
  runId?: string;
  messageId?: string;
};

/** Token aggregate for a single model / day / session bucket. */
export type UsageBucket = {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  entryCount: number;
  /** Total generation duration in ms across records that reported it. */
  durationMs?: number;
  /**
   * Completion tokens belonging to records that reported `durationMs`.
   * Keeps tok/s honest when only part of a bucket carries duration data.
   */
  durationMsCompletionTokens?: number;
  firstTokenMs?: number;
  successCount?: number;
};

/** Per-session total for the rollup session breakdown. */
export type UsageSessionTotal = UsageBucket & {
  sessionId: string;
  firstAt: string;
  lastAt: string;
};

/**
 * Model + Key usage row. `providerId` identifies the provider configuration
 * (and therefore its credential source) without exposing the credential.
 * `null` represents legacy ledger entries written before provider attribution.
 */
export type UsageModelKeyTotal = UsageBucket & {
  providerId: string | null;
  modelId: string;
};

/**
 * Prompt-cache hit rate using Pi's normalized token semantics:
 * cache reads / (uncached input + cache reads + cache writes).
 * Output tokens are deliberately excluded. Returns null when no input tokens
 * were reported, so clients can render an honest unknown state.
 */
export function computePromptCacheHitRate(
  usage: Pick<UsageBucket, 'promptTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>,
): number | null {
  const promptTokens = Math.max(0, usage.promptTokens);
  const cacheReadTokens = Math.max(0, usage.cacheReadTokens);
  const cacheWriteTokens = Math.max(0, usage.cacheWriteTokens);
  const cacheableInputTokens = promptTokens + cacheReadTokens + cacheWriteTokens;
  if (cacheableInputTokens === 0) {
    return null;
  }
  return cacheReadTokens / cacheableInputTokens;
}

/**
 * Output generation speed in tokens per second.
 * Only counts completion tokens from records that reported `durationMs`, so
 * partial duration coverage never inflates the rate. Returns null when the
 * provider reported no usable duration or output, so clients can render an
 * honest unknown state instead of fabricating a number.
 */
export function computeTokensPerSecond(
  usage: Pick<UsageBucket, 'completionTokens' | 'durationMs' | 'durationMsCompletionTokens'>,
): number | null {
  const durationMs = usage.durationMs;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  const completionTokens = Math.max(0, usage.durationMsCompletionTokens ?? usage.completionTokens);
  if (completionTokens === 0) {
    return null;
  }
  return completionTokens / (durationMs / 1000);
}

/**
 * One model call in the rolling call log (`usage/list-recent`).
 *
 * A flattened `UsageRecord` with the optional token fields defaulted, so the
 * client renders a table without re-deriving zeroes per cell. `id` is stable
 * across polls, which keeps React keys (and row identity) steady.
 */
export type UsageCallLogEntry = {
  id: string;
  recordedAt: string;
  sessionId: string;
  projectPath: string | null;
  providerId: string | null;
  modelId: string | null;
  thinkingLevel?: ThinkingLevel;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  /** Generation duration in ms when the provider reported it. */
  durationMs?: number;
  /** First token latency in ms when the provider reported it. */
  firstTokenMs?: number;
  /** Turn outcome when the ledger recorded one. */
  success?: boolean;
  source: 'assistant-usage' | 'host-estimate';
};

/**
 * One page of the rolling call log returned by `usage/list-recent`.
 *
 * Paging is offset-based over a newest-first ordering. The window is bounded
 * (an hour by default), so offsets stay small and a page is cheap to skip to;
 * `offset` is echoed back because the Host clamps it to the window size.
 */
export type UsageCallLog = {
  /** Length of the rolling window in minutes. */
  windowMinutes: number;
  /** ISO lower bound of the window (inclusive). */
  from: string;
  /** ISO timestamp the log was produced. */
  to: string;
  /** Calls on this page, newest first. */
  entries: UsageCallLogEntry[];
  /** Zero-based index of the first returned row within the window. */
  offset: number;
  /** Page size that was applied. */
  limit: number;
  /** Total calls inside the window, across all pages. */
  totalInWindow: number;
  /** True when rows exist outside this page. */
  truncated: boolean;
};

/** Aggregated token statistics returned by `usage/get-rollup`. */
export type UsageRollup = {
  scope: SessionScope | { kind: 'global' };
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  entryCount: number;
  sessionCount: number;
  firstAt: string | null;
  lastAt: string | null;
  byModel: Record<string, UsageBucket>;
  /** Provider-config (Key) + model rows, sorted by total tokens descending. */
  byModelKey: UsageModelKeyTotal[];
  byDay: Record<string, UsageBucket>;
  bySession: UsageSessionTotal[];
};
