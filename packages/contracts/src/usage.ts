/**
 * Token / context usage contracts (CE-OBS).
 * Host maps Pi `contextUsage` / assistant usage → `AgentEvent` `usage/update`.
 */

import type { SessionScope } from './host.js';

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
  /** Tokens currently occupying the model context when known. */
  tokensUsed?: number;
  /** Model context window size when known. */
  tokensLimit?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** 0–1 fraction of context used when computable. */
  contextRatio?: number;
  updatedAt: string;
  source?: UsageSource;
  /** Category split for UI ring details (optional). */
  breakdown?: ContextUsageBreakdown;
};

/**
 * One billable turn recorded in the usage ledger (CE-OBS).
 * Only assistant-usage (agent_end) and host-estimate entries are recorded;
 * `pi-contextUsage` snapshots are cumulative context occupancy and never summable.
 */
export type UsageRecord = {
  sessionId: string;
  /** Project path when the session is project-scoped; null for general sessions. */
  projectPath: string | null;
  /** Model used for the turn when known. */
  modelId?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens: number;
  source: 'assistant-usage' | 'host-estimate';
  /** ISO timestamp of the turn. */
  recordedAt: string;
};

/** Token aggregate for a single model / day / session bucket. */
export type UsageBucket = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  entryCount: number;
};

/** Per-session total for the rollup session breakdown. */
export type UsageSessionTotal = UsageBucket & {
  sessionId: string;
  firstAt: string;
  lastAt: string;
};

/** Aggregated token statistics returned by `usage/get-rollup`. */
export type UsageRollup = {
  scope: SessionScope | { kind: 'global' };
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  entryCount: number;
  sessionCount: number;
  firstAt: string | null;
  lastAt: string | null;
  byModel: Record<string, UsageBucket>;
  byDay: Record<string, UsageBucket>;
  bySession: UsageSessionTotal[];
};
