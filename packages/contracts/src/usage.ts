/**
 * Token / context usage contracts (CE-OBS).
 * Host maps Pi `contextUsage` / assistant usage → `AgentEvent` `usage/update`.
 */

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
