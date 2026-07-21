/**
 * Token / context usage contracts (CE-OBS).
 * Host maps Pi `contextUsage` / assistant usage → `AgentEvent` `usage/update`.
 */

export type UsageSource = 'pi-contextUsage' | 'assistant-usage' | 'host-estimate';

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
};
