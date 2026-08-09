import { describe, expect, it } from 'vitest';
import { computePromptCacheHitRate } from './usage.js';

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
