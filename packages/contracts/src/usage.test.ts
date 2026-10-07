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
  it('rates the whole output over the decode window when reasoning was streamed first', () => {
    expect(
      computeTokensPerSecond({
        completionTokens: 200,
        durationMs: 3_500,
        firstTokenMs: 500,
        firstTokenKind: 'reasoning',
        reasoningTokens: 120,
      }),
    ).toBeCloseTo(200 / 3);
  });

  it('rates only visible tokens when reasoning ran unseen before the first token', () => {
    // Real openai-codex row: 3132 output tokens once showed as 40154 tok/s.
    expect(
      computeTokensPerSecond({
        completionTokens: 3_132,
        durationMs: 119_813,
        firstTokenMs: 117_813,
        firstTokenKind: 'content',
        reasoningTokens: 3_000,
      }),
    ).toBeCloseTo(132 / 2);
    expect(
      computeTokensPerSecond({
        completionTokens: 200,
        durationMs: 3_500,
        firstTokenMs: 500,
        firstTokenKind: 'content',
        reasoningTokens: 0,
      }),
    ).toBeCloseTo(200 / 3);
  });

  it('uses end-to-end duration when it is unknown where the tokens fell', () => {
    expect(
      computeTokensPerSecond({ completionTokens: 3_132, durationMs: 119_813, firstTokenMs: 119_735 }),
    ).toBeCloseTo(3_132 / 119.813);
    expect(
      computeTokensPerSecond({
        completionTokens: 200,
        durationMs: 3_500,
        firstTokenMs: 500,
        firstTokenKind: 'content',
      }),
    ).toBeCloseTo(200 / 3.5);
    expect(
      computeTokensPerSecond({
        completionTokens: 200,
        durationMs: 3_500,
        firstTokenMs: 500,
        reasoningTokens: 50,
      }),
    ).toBeCloseTo(200 / 3.5);
  });

  it('uses end-to-end duration when the output was all reasoning', () => {
    expect(
      computeTokensPerSecond({
        completionTokens: 200,
        durationMs: 3_500,
        firstTokenMs: 500,
        firstTokenKind: 'content',
        reasoningTokens: 200,
      }),
    ).toBeCloseTo(200 / 3.5);
  });

  it('prefers duration-scoped completion tokens over the full bucket', () => {
    expect(
      computeTokensPerSecond({
        completionTokens: 400,
        durationMs: 3_500,
        firstTokenMs: 500,
        durationMsCompletionTokens: 150,
        firstTokenKind: 'reasoning',
      }),
    ).toBeCloseTo(150 / 3);
  });

  it('falls back to end-to-end duration when first-token latency is missing', () => {
    expect(computeTokensPerSecond({ completionTokens: 200, durationMs: 2_000 })).toBeCloseTo(100);
  });

  it('returns null without a usable duration or output', () => {
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
      computeTokensPerSecond({
        completionTokens: 200,
        durationMs: 2_000,
        firstTokenMs: 2_000,
        firstTokenKind: 'reasoning',
      }),
    ).toBeCloseTo(100);
  });

  it('falls back to end-to-end duration when decode is a buffered flush', () => {
    expect(
      computeTokensPerSecond({
        completionTokens: 108,
        durationMs: 7_511,
        firstTokenMs: 7_500,
        firstTokenKind: 'reasoning',
      }),
    ).toBeCloseTo(108 / 7.511);
  });

  it('keeps short but real decode windows (flash completions)', () => {
    expect(
      computeTokensPerSecond({
        completionTokens: 57,
        durationMs: 1_200,
        firstTokenMs: 640,
        firstTokenKind: 'reasoning',
      }),
    ).toBeCloseTo(57 / 0.56);
    expect(
      computeTokensPerSecond({
        completionTokens: 200,
        durationMs: 1_999,
        firstTokenMs: 500,
        firstTokenKind: 'content',
        reasoningTokens: 0,
      }),
    ).toBeCloseTo(200 / 1.499);
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
