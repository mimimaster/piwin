/**
 * Map Pi contextUsage / assistant usage shapes into ContextUsageSnapshot.
 * Never invents token counts for totals — only maps when numbers are present.
 * Breakdown may be host-estimated and is labeled as such.
 */
import type {
  ContextUsageBreakdown,
  ContextUsageSnapshot,
  UsageSource,
} from '@piwin/contracts';

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

  const tokensUsed =
    readNumber(nested.tokensUsed) ??
    readNumber(nested.used) ??
    readNumber(nested.contextTokens) ??
    readNumber(nested.inputTokens);
  const tokensLimit =
    readNumber(nested.tokensLimit) ??
    readNumber(nested.limit) ??
    readNumber(nested.contextWindow) ??
    readNumber(nested.maxTokens);
  const promptTokens =
    readNumber(nested.promptTokens) ??
    readNumber(nested.input_tokens) ??
    readNumber(nested.inputTokens);
  const completionTokens =
    readNumber(nested.completionTokens) ??
    readNumber(nested.output_tokens) ??
    readNumber(nested.outputTokens);
  const totalTokens =
    readNumber(nested.totalTokens) ??
    readNumber(nested.total) ??
    (promptTokens !== undefined && completionTokens !== undefined
      ? promptTokens + completionTokens
      : undefined);

  const hasAny =
    tokensUsed !== undefined ||
    tokensLimit !== undefined ||
    promptTokens !== undefined ||
    completionTokens !== undefined ||
    totalTokens !== undefined;
  if (!hasAny) {
    return null;
  }

  const snapshot: ContextUsageSnapshot = {
    sessionId,
    updatedAt: new Date().toISOString(),
    source,
  };
  if (tokensUsed !== undefined) snapshot.tokensUsed = tokensUsed;
  if (tokensLimit !== undefined) snapshot.tokensLimit = tokensLimit;
  if (promptTokens !== undefined) snapshot.promptTokens = promptTokens;
  if (completionTokens !== undefined) snapshot.completionTokens = completionTokens;
  if (totalTokens !== undefined) snapshot.totalTokens = totalTokens;

  const usedForRatio = tokensUsed ?? totalTokens;
  if (
    usedForRatio !== undefined &&
    tokensLimit !== undefined &&
    tokensLimit > 0
  ) {
    snapshot.contextRatio = Math.min(1, Math.max(0, usedForRatio / tokensLimit));
  }

  const mappedBreakdown = mapBreakdown(
    asRecord(nested.breakdown) ??
      asRecord(nested.contextBreakdown) ??
      asRecord(record.breakdown),
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
    systemPromptTokens +
    toolDefinitionsTokens +
    rulesTokens +
    skillsTokens +
    mcpTokens;
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
    readNumber(raw.systemPromptTokens) ??
    readNumber(raw.system) ??
    readNumber(raw.system_prompt);
  const toolDefinitionsTokens =
    readNumber(raw.toolDefinitionsTokens) ??
    readNumber(raw.tools) ??
    readNumber(raw.tool_definitions);
  const rulesTokens = readNumber(raw.rulesTokens) ?? readNumber(raw.rules);
  const skillsTokens = readNumber(raw.skillsTokens) ?? readNumber(raw.skills);
  const mcpTokens = readNumber(raw.mcpTokens) ?? readNumber(raw.mcp);
  const conversationTokens =
    readNumber(raw.conversationTokens) ??
    readNumber(raw.conversation) ??
    readNumber(raw.messages);
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

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}
