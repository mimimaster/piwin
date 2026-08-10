/**
 * Map Pi contextUsage / assistant usage shapes into ContextUsageSnapshot.
 * Never invents token counts for totals — only maps when numbers are present.
 * Breakdown may be host-estimated and is labeled as such.
 */
import type { ContextUsageBreakdown, ContextUsageSnapshot, UsageSource } from '@piwin/contracts';

export function mapUsageSnapshot(
  sessionId: string,
  raw: unknown,
  source: UsageSource = 'pi-contextUsage',
): ContextUsageSnapshot | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const nested =
    asRecord(record.contextUsage) ??
    asRecord(record.usage) ??
    asRecord(record.tokenUsage) ??
    record;

  const modelId = readString(record.modelId) ?? readString(record.model);
  const tokensUsed =
    readNumber(nested.tokensUsed) ??
    readNumber(nested.used) ??
    readNumber(nested.contextTokens) ??
    readNumber(nested.tokens) ??
    readNumber(nested.inputTokens);
  const tokensLimit =
    readNumber(nested.tokensLimit) ??
    readNumber(nested.limit) ??
    readNumber(nested.contextWindow) ??
    readNumber(nested.maxTokens);
  const promptTokens =
    readNumber(nested.promptTokens) ??
    readNumber(nested.input_tokens) ??
    readNumber(nested.inputTokens) ??
    readNumber(nested.input);
  const completionTokens =
    readNumber(nested.completionTokens) ??
    readNumber(nested.output_tokens) ??
    readNumber(nested.outputTokens) ??
    readNumber(nested.output);
  const promptTokenDetails = asRecord(nested.prompt_tokens_details);
  const cacheReadTokens =
    readNumber(nested.cacheReadTokens) ??
    readNumber(nested.cacheRead) ??
    readNumber(nested.cache_read) ??
    readNumber(nested.cache_read_tokens) ??
    readNumber(nested.cache_read_input_tokens) ??
    readNumber(nested.cached_tokens) ??
    readNumber(promptTokenDetails?.cached_tokens);
  const cacheWriteTokens =
    readNumber(nested.cacheWriteTokens) ??
    readNumber(nested.cacheWrite) ??
    readNumber(nested.cache_write) ??
    readNumber(nested.cache_write_tokens) ??
    readNumber(nested.cache_creation_input_tokens) ??
    readNumber(promptTokenDetails?.cache_write_tokens);
  const durationMs =
    readNumber(nested.durationMs) ?? readNumber(nested.duration) ?? readNumber(record.durationMs);
  const totalTokens =
    readNumber(nested.totalTokens) ??
    readNumber(nested.total) ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)
      : undefined);

  // Context occupancy ≠ billable turn total. When providers only report turn
  // fields, input-side tokens (prompt + cache) best approximate window fill.
  const inputSideTokens =
    promptTokens !== undefined || cacheReadTokens !== undefined || cacheWriteTokens !== undefined
      ? (promptTokens ?? 0) + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0)
      : undefined;
  const resolvedTokensUsed = tokensUsed ?? inputSideTokens;

  const hasAny =
    resolvedTokensUsed !== undefined ||
    tokensLimit !== undefined ||
    promptTokens !== undefined ||
    completionTokens !== undefined ||
    cacheReadTokens !== undefined ||
    cacheWriteTokens !== undefined ||
    totalTokens !== undefined;
  if (!hasAny) {
    return null;
  }

  const snapshot: ContextUsageSnapshot = {
    sessionId,
    updatedAt: new Date().toISOString(),
    source,
  };
  if (modelId !== undefined) snapshot.modelId = modelId;
  if (resolvedTokensUsed !== undefined) snapshot.tokensUsed = resolvedTokensUsed;
  if (tokensLimit !== undefined) snapshot.tokensLimit = tokensLimit;
  if (promptTokens !== undefined) snapshot.promptTokens = promptTokens;
  if (completionTokens !== undefined) snapshot.completionTokens = completionTokens;
  if (cacheReadTokens !== undefined) snapshot.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== undefined) snapshot.cacheWriteTokens = cacheWriteTokens;
  if (totalTokens !== undefined) snapshot.totalTokens = totalTokens;
  if (durationMs !== undefined) snapshot.durationMs = durationMs;

  const usedForRatio = resolvedTokensUsed ?? totalTokens;
  if (usedForRatio !== undefined && tokensLimit !== undefined && tokensLimit > 0) {
    snapshot.contextRatio = Math.min(1, Math.max(0, usedForRatio / tokensLimit));
  } else {
    const reportedPercent = readNumber(nested.percent);
    if (reportedPercent !== undefined) {
      const ratio = reportedPercent > 1 ? reportedPercent / 100 : reportedPercent;
      snapshot.contextRatio = Math.min(1, Math.max(0, ratio));
    }
  }

  const mappedBreakdown = mapBreakdown(
    asRecord(nested.breakdown) ?? asRecord(nested.contextBreakdown) ?? asRecord(record.breakdown),
  );
  if (mappedBreakdown) {
    snapshot.breakdown = mappedBreakdown;
  } else if (usedForRatio !== undefined) {
    const estimateInput: {
      tokensUsed: number;
      promptTokens?: number;
      completionTokens?: number;
    } = { tokensUsed: usedForRatio };
    if (promptTokens !== undefined) estimateInput.promptTokens = promptTokens;
    if (completionTokens !== undefined) {
      estimateInput.completionTokens = completionTokens;
    }
    snapshot.breakdown = estimateUsageBreakdown(estimateInput);
  }

  return snapshot;
}

/** Host-estimate usage after a mock turn (deterministic, labeled). */
export function estimateMockUsage(
  sessionId: string,
  promptText: string,
  completionText: string,
  durationMs?: number,
): ContextUsageSnapshot {
  const promptTokens = Math.max(1, Math.ceil(promptText.length / 4));
  const completionTokens = Math.max(1, Math.ceil(completionText.length / 4));
  const totalTokens = promptTokens + completionTokens;
  const tokensLimit = 128_000;
  return {
    sessionId,
    promptTokens,
    completionTokens,
    totalTokens,
    tokensUsed: totalTokens,
    tokensLimit,
    contextRatio: Math.min(1, totalTokens / tokensLimit),
    updatedAt: new Date().toISOString(),
    source: 'host-estimate',
    ...(durationMs !== undefined ? { durationMs } : {}),
    breakdown: estimateUsageBreakdown({
      tokensUsed: totalTokens,
      promptTokens,
      completionTokens,
    }),
  };
}

/**
 * Split total context into Codex-style categories.
 * Honest host-estimate: fixed overhead buckets + remainder conversation.
 */
export function estimateUsageBreakdown(input: {
  tokensUsed: number;
  promptTokens?: number;
  completionTokens?: number;
}): ContextUsageBreakdown {
  const used = Math.max(0, Math.floor(input.tokensUsed));
  if (used === 0) {
    return {
      systemPromptTokens: 0,
      toolDefinitionsTokens: 0,
      rulesTokens: 0,
      skillsTokens: 0,
      mcpTokens: 0,
      conversationTokens: 0,
      source: 'host-estimate',
    };
  }
  // Proportional buckets (sum=1) so small mock turns still show non-zero conversation.
  const systemPromptTokens = Math.floor(used * 0.04);
  const toolDefinitionsTokens = Math.floor(used * 0.12);
  const rulesTokens = Math.floor(used * 0.05);
  const skillsTokens = Math.floor(used * 0.03);
  const mcpTokens = Math.floor(used * 0.02);
  const overhead =
    systemPromptTokens + toolDefinitionsTokens + rulesTokens + skillsTokens + mcpTokens;
  const conversationTokens = Math.max(0, used - overhead);

  return {
    systemPromptTokens,
    toolDefinitionsTokens,
    rulesTokens,
    skillsTokens,
    mcpTokens,
    conversationTokens,
    source: 'host-estimate',
  };
}

function mapBreakdown(raw: Record<string, unknown> | null): ContextUsageBreakdown | null {
  if (!raw) return null;
  const breakdown: ContextUsageBreakdown = { source: 'pi' };
  const systemPromptTokens =
    readNumber(raw.systemPromptTokens) ?? readNumber(raw.system) ?? readNumber(raw.system_prompt);
  const toolDefinitionsTokens =
    readNumber(raw.toolDefinitionsTokens) ??
    readNumber(raw.tools) ??
    readNumber(raw.tool_definitions);
  const rulesTokens = readNumber(raw.rulesTokens) ?? readNumber(raw.rules);
  const skillsTokens = readNumber(raw.skillsTokens) ?? readNumber(raw.skills);
  const mcpTokens = readNumber(raw.mcpTokens) ?? readNumber(raw.mcp);
  const conversationTokens =
    readNumber(raw.conversationTokens) ?? readNumber(raw.conversation) ?? readNumber(raw.messages);
  let hasAny = false;
  if (systemPromptTokens !== undefined) {
    breakdown.systemPromptTokens = systemPromptTokens;
    hasAny = true;
  }
  if (toolDefinitionsTokens !== undefined) {
    breakdown.toolDefinitionsTokens = toolDefinitionsTokens;
    hasAny = true;
  }
  if (rulesTokens !== undefined) {
    breakdown.rulesTokens = rulesTokens;
    hasAny = true;
  }
  if (skillsTokens !== undefined) {
    breakdown.skillsTokens = skillsTokens;
    hasAny = true;
  }
  if (mcpTokens !== undefined) {
    breakdown.mcpTokens = mcpTokens;
    hasAny = true;
  }
  if (conversationTokens !== undefined) {
    breakdown.conversationTokens = conversationTokens;
    hasAny = true;
  }
  return hasAny ? breakdown : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}
