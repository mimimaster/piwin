/**
 * External session backends do not populate Pi's `SessionContextStateStore`,
 * so their context occupancy comes from the latest API request measurement
 * (`usage/finalized` or `catalog/usage` via `SessionUsageTotals.latestRequest`)
 * when reported, falling back to transcript character estimation only when the
 * backend has not reported token usage yet.
 */
import type { ContextUsageSnapshot, SessionUsageTotals } from '@piwin/contracts';
import type {
  ContextRingLastRequest,
  SelectContextRingViewInput,
} from './context-telemetry-selector.js';

export type ExternalContextFallbackInput = {
  isExternalBackend: boolean;
  sessionUsageTotals?: SessionUsageTotals | null | undefined;
  contextUsage?: ContextUsageSnapshot | null | undefined;
  fallbackTokensUsed: number;
  tokensLimit?: number | undefined;
  streaming?: boolean | undefined;
};

export function resolveExternalContextFallback(
  input: ExternalContextFallbackInput,
): SelectContextRingViewInput['fallbackUsage'] | undefined {
  if (!input.isExternalBackend) {
    return undefined;
  }

  const latest = input.sessionUsageTotals?.latestRequest;
  const measuredTokens = latest
    ? (latest.promptTokens ?? 0) +
      (latest.cacheReadTokens ?? 0) +
      (latest.cacheWriteTokens ?? 0) +
      (latest.completionTokens ?? 0)
    : 0;

  if (measuredTokens > 0 && latest) {
    const lastRequest: ContextRingLastRequest = {
      messageId: latest.messageId,
      ...(typeof latest.promptTokens === 'number' ? { promptTokens: latest.promptTokens } : {}),
      ...(typeof latest.cacheReadTokens === 'number'
        ? { cacheReadTokens: latest.cacheReadTokens }
        : {}),
      ...(typeof latest.cacheWriteTokens === 'number'
        ? { cacheWriteTokens: latest.cacheWriteTokens }
        : {}),
      ...(typeof latest.completionTokens === 'number'
        ? { completionTokens: latest.completionTokens }
        : {}),
      totalTokens: measuredTokens,
      ...(typeof latest.durationMs === 'number' ? { durationMs: latest.durationMs } : {}),
      ...(typeof latest.firstTokenMs === 'number' ? { firstTokenMs: latest.firstTokenMs } : {}),
      ...(typeof latest.reasoningTokens === 'number'
        ? { reasoningTokens: latest.reasoningTokens }
        : {}),
      ...(latest.firstTokenKind !== undefined ? { firstTokenKind: latest.firstTokenKind } : {}),
    };

    return {
      tokensUsed: measuredTokens,
      ...(typeof input.tokensLimit === 'number' ? { tokensLimit: input.tokensLimit } : {}),
      quality: 'measured',
      ...(input.streaming ? { phase: 'streaming' } : {}),
      lastRequest,
    };
  }

  const estimatedTokens = input.contextUsage?.tokensUsed ?? input.fallbackTokensUsed;
  if (estimatedTokens <= 0) {
    return undefined;
  }

  return {
    tokensUsed: estimatedTokens,
    ...(typeof input.tokensLimit === 'number' ? { tokensLimit: input.tokensLimit } : {}),
    quality: 'estimated',
    ...(input.streaming ? { phase: 'streaming' } : {}),
  };
}
