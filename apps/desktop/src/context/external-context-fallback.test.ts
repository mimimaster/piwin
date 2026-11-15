import { describe, expect, it } from 'vitest';
import { resolveExternalContextFallback } from './external-context-fallback.js';

describe('resolveExternalContextFallback', () => {
  it('returns undefined for native Pi sessions', () => {
    expect(
      resolveExternalContextFallback({
        isExternalBackend: false,
        fallbackTokensUsed: 500,
      }),
    ).toBeUndefined();
  });

  it('prefers API-measured context tokens from latestRequest over character estimation', () => {
    const result = resolveExternalContextFallback({
      isExternalBackend: true,
      fallbackTokensUsed: 1200,
      tokensLimit: 200_000,
      sessionUsageTotals: {
        sessionId: 'sess-claude',
        userTurnCount: 3,
        entryCount: 3,
        promptTokens: 500,
        completionTokens: 900,
        cacheReadTokens: 180_000,
        cacheWriteTokens: 5_000,
        totalTokens: 186_400,
        latestRequest: {
          messageId: 'msg-3',
          promptTokens: 150,
          cacheReadTokens: 180_000,
          cacheWriteTokens: 1_500,
          completionTokens: 350,
          durationMs: 4200,
          firstTokenMs: 1100,
        },
      },
    });
    expect(result).toEqual({
      tokensUsed: 182_000,
      tokensLimit: 200_000,
      quality: 'measured',
      lastRequest: {
        messageId: 'msg-3',
        promptTokens: 150,
        cacheReadTokens: 180_000,
        cacheWriteTokens: 1_500,
        completionTokens: 350,
        totalTokens: 182_000,
        durationMs: 4200,
        firstTokenMs: 1100,
      },
    });
  });

  it('falls back to estimated transcript tokens when no API usage has been recorded yet', () => {
    const result = resolveExternalContextFallback({
      isExternalBackend: true,
      fallbackTokensUsed: 840,
      tokensLimit: 256_000,
      streaming: true,
    });
    expect(result).toEqual({
      tokensUsed: 840,
      tokensLimit: 256_000,
      quality: 'estimated',
      phase: 'streaming',
    });
  });
});
