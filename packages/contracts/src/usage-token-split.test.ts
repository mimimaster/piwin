import { describe, expect, it } from 'vitest';
import { normalizeUsageTokenSplit } from './usage-token-split.js';

describe('normalizeUsageTokenSplit', () => {
  it('moves cache out of a cache-inclusive prompt count', () => {
    // Observed external-agent turn: prompt includes the 34.5M cached tokens.
    const row = {
      promptTokens: 35_962_417,
      completionTokens: 147_044,
      cacheReadTokens: 34_523_776,
      cacheWriteTokens: 0,
      totalTokens: 36_109_461,
    };
    expect(normalizeUsageTokenSplit(row)).toEqual({ ...row, promptTokens: 1_438_641 });
  });

  it('subtracts cache writes too', () => {
    expect(
      normalizeUsageTokenSplit({
        promptTokens: 1_000,
        completionTokens: 50,
        cacheReadTokens: 600,
        cacheWriteTokens: 300,
        totalTokens: 1_050,
      }).promptTokens,
    ).toBe(100);
  });

  it('leaves Pi-split rows unchanged', () => {
    const row = {
      promptTokens: 2_058,
      completionTokens: 2_409,
      cacheReadTokens: 275_140,
      cacheWriteTokens: 0,
      totalTokens: 279_607,
    };
    expect(normalizeUsageTokenSplit(row)).toBe(row);
  });

  it('leaves rows without cache or without a full split unchanged', () => {
    const noCache = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    expect(normalizeUsageTokenSplit(noCache)).toBe(noCache);
    const totalOnly = { cacheReadTokens: 40, totalTokens: 100 };
    expect(normalizeUsageTokenSplit(totalOnly)).toBe(totalOnly);
  });

  it('does not produce a negative prompt when cache exceeds the prompt', () => {
    const row = { promptTokens: 10, completionTokens: 5, cacheReadTokens: 20, totalTokens: 15 };
    expect(normalizeUsageTokenSplit(row)).toBe(row);
  });
});
