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
      computeTokensPerSecond({ completionTokens: 200, durationMs: 3_500, firstTokenMs: 500 }),
    ).toBeCloseTo(200 / 3);
  });

  it('prefers duration-scoped completion tokens over the full bucket', () => {
    expect(
      computeTokensPerSecond({
        completionTokens: 400,
        durationMs: 3_500,
        firstTokenMs: 500,
        durationMsCompletionTokens: 150,
      }),
    ).toBeCloseTo(150 / 3);
  });

  it('falls back to end-to-end duration when first-token latency is missing', () => {
    expect(computeTokensPerSecond({ completionTokens: 200, durationMs: 2_000 })).toBeCloseTo(100);
  });

  it('returns null without a usable decode window', () => {
    expect(
      computeTokensPerSecond({ completionTokens: 0, durationMs: 3_500, firstTokenMs: 500 }),
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

  it('returns null when the observation window is under two seconds', () => {
    expect(
      computeTokensPerSecond({ completionTokens: 108, durationMs: 7_511, firstTokenMs: 7_500 }),
    ).toBeNull();
    expect(
      computeTokensPerSecond({ completionTokens: 200, durationMs: 2_499, firstTokenMs: 500 }),
    ).toBeNull();
    expect(computeTokensPerSecond({ completionTokens: 200, durationMs: 1_999 })).toBeNull();
  });

  it('accepts a decode window of exactly two seconds', () => {
    expect(
      computeTokensPerSecond({ completionTokens: 200, durationMs: 2_500, firstTokenMs: 500 }),
    ).toBeCloseTo(100);
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
