import { describe, expect, it } from 'vitest';
import {
  computePromptCacheHitRate,
  computeTokensPerSecond,
  shouldAcceptContextUsage,
} from './usage.js';

describe('computePromptCacheHitRate', () => {
  it('uses only prompt-side tokens in the cache denominator', () => {
    expect(
      computePromptCacheHitRate({
        promptTokens: 600,
        cacheReadTokens: 150,
        cacheWriteTokens: 50,
      }),
    ).toBeCloseTo(0.1875);
  });

  it('returns null when the provider reported no prompt-side usage', () => {
    expect(
      computePromptCacheHitRate({
        promptTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBeNull();
  });

  it('does not let malformed negative counters produce an invalid rate', () => {
    expect(
      computePromptCacheHitRate({
        promptTokens: -10,
        cacheReadTokens: 20,
        cacheWriteTokens: -5,
      }),
    ).toBe(1);
  });
});

describe('computeTokensPerSecond', () => {
  it('divides output tokens by time after the first token', () => {
    expect(
      computeTokensPerSecond({ completionTokens: 200, durationMs: 2_000, firstTokenMs: 500 }),
    ).toBeCloseTo(200 / 1.5);
  });

  it('prefers duration-scoped completion tokens over the full bucket', () => {
    expect(
      computeTokensPerSecond({
        completionTokens: 400,
        durationMs: 2_000,
        firstTokenMs: 500,
        durationMsCompletionTokens: 150,
      }),
    ).toBeCloseTo(150 / 1.5);
  });

  it('returns null without first-token latency or a usable decode window', () => {
    expect(computeTokensPerSecond({ completionTokens: 200, durationMs: 2_000 })).toBeNull();
    expect(
      computeTokensPerSecond({ completionTokens: 0, durationMs: 2_000, firstTokenMs: 500 }),
    ).toBeNull();
    expect(computeTokensPerSecond({ completionTokens: 200 })).toBeNull();
    expect(
      computeTokensPerSecond({ completionTokens: 200, durationMs: 0, firstTokenMs: 0 }),
    ).toBeNull();
    expect(
      computeTokensPerSecond({ completionTokens: 200, durationMs: Number.NaN, firstTokenMs: 10 }),
    ).toBeNull();
    expect(
      computeTokensPerSecond({ completionTokens: 200, durationMs: 2_000, firstTokenMs: 2_000 }),
    ).toBeNull();
  });
});

describe('shouldAcceptContextUsage', () => {
  const measuredUsage = {
    sessionId: 's1',
    totalTokens: 300_000,
    updatedAt: '2026-08-09T09:47:07.479Z',
    source: 'assistant-usage' as const,
  };
  const estimatedUsage = {
    sessionId: 's1',
    totalTokens: 409,
    updatedAt: '2026-08-09T09:47:07.485Z',
    source: 'host-estimate' as const,
  };

  it('rejects a fallback estimate after measured usage', () => {
    expect(shouldAcceptContextUsage(measuredUsage, estimatedUsage)).toBe(false);
  });

  it('accepts measured usage after a fallback estimate', () => {
    expect(shouldAcceptContextUsage(estimatedUsage, measuredUsage)).toBe(true);
  });

  it('accepts the first snapshot', () => {
    expect(shouldAcceptContextUsage(null, estimatedUsage)).toBe(true);
  });
});
