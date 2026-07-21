/**
 * Map Pi contextUsage / assistant usage shapes into ContextUsageSnapshot.
 * Never invents token counts — only maps when numbers are present.
 */
import type { ContextUsageSnapshot, UsageSource } from '@piwin/contracts';

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
  };
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
