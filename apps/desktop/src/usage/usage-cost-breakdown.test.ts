import { describe, expect, it } from 'vitest';
import type { UsageModelKeyTotal } from '@piwin/contracts';
import { buildUsageCostBreakdown, splitUsageModelRoute, UNKNOWN_KEY_LABEL } from './usage-cost-breakdown';

function row(
  modelId: string,
  providerId: string | null,
  cost: number | undefined,
  options: { calls?: number; priced?: number; tokens?: number; cacheRead?: number; reference?: string } = {},
): UsageModelKeyTotal {
  const calls = options.calls ?? 1;
  const tokens = options.tokens ?? 100;
  const cacheRead = options.cacheRead ?? 0;
  return {
    modelId, providerId, promptTokens: tokens - cacheRead, completionTokens: 0, cacheReadTokens: cacheRead,
    cacheWriteTokens: 0, totalTokens: tokens, entryCount: calls,
    ...(cost !== undefined
      ? { estimatedCostUsd: cost, pricedEntryCount: options.priced ?? calls }
      : { pricedEntryCount: 0 }),
    ...(options.reference ? { costReference: options.reference } : {}),
  };
}

const ROWS = [
  row('grok-4.6', 'custom-openai', 2, { calls: 20, tokens: 400 }),
  row('grok-4.6', 'xai', 1, { calls: 10, tokens: 200, priced: 8 }),
  row('claude-opus-5-5', 'kiro', 6, { calls: 4, tokens: 300, cacheRead: 150 }),
  row('qwen-local', 'ollama', undefined, { calls: 30, tokens: 900 }),
  row('qwen-cheap', 'ollama', undefined, { calls: 5, tokens: 10 }),
];

describe('buildUsageCostBreakdown', () => {
  it('merges a model across Keys and exposes the parts as children', () => {
    const { priced } = buildUsageCostBreakdown(ROWS, 'model');
    expect(priced.map((group) => group.label)).toEqual(['claude-opus-5-5', 'grok-4.6']);
    const grok = priced[1];
    expect(grok?.costUsd).toBe(3);
    expect(grok?.calls).toBe(30);
    expect(grok?.pricedCalls).toBe(28);
    expect(grok?.unpricedCalls).toBe(2);
    expect(grok?.perCallUsd).toBeCloseTo(3 / 28);
    expect(grok?.secondary).toEqual({ kind: 'key', values: ['custom-openai', 'xai'] });
    expect(grok?.children.map((child) => child.label)).toEqual(['custom-openai', 'xai']);
    expect(priced[0]?.children).toEqual([]);
  });

  it('computes share of the priced total and bar length against the top row', () => {
    const { priced, pricedTotal } = buildUsageCostBreakdown(ROWS, 'model');
    expect(pricedTotal.costUsd).toBe(9);
    expect(priced[0]?.share).toBeCloseTo(6 / 9);
    expect(priced[0]?.barRatio).toBe(1);
    expect(priced[1]?.barRatio).toBeCloseTo(0.5);
    expect(priced[1]?.children[0]?.barRatio).toBeCloseTo(2 / 6);
    expect(priced[0]?.cacheHitRate).toBeCloseTo(0.5);
  });

  it('groups by Key with models as children', () => {
    const { priced } = buildUsageCostBreakdown(ROWS, 'key');
    expect(priced.map((group) => group.label)).toEqual(['kiro', 'custom-openai', 'xai']);
    expect(priced[0]?.secondary).toEqual({ kind: 'model', values: ['claude-opus-5-5'] });
  });

  it('keeps model × Key rows flat', () => {
    const { priced } = buildUsageCostBreakdown(ROWS, 'model-key');
    expect(priced).toHaveLength(3);
    expect(priced.every((group) => group.children.length === 0)).toBe(true);
  });

  it('keeps unpriced rows out of the ranking and never as free', () => {
    const { priced, unpriced, unpricedTotal } = buildUsageCostBreakdown(ROWS, 'model');
    expect(priced.some((group) => group.label.startsWith('qwen'))).toBe(false);
    expect(unpriced.map((entry) => entry.label)).toEqual(['qwen-local', 'qwen-cheap']);
    expect(unpriced[0]?.costUsd).toBeUndefined();
    expect(unpriced[0]?.share).toBeUndefined();
    expect(unpricedTotal.calls).toBe(35);
  });

  it('sorts by calls or tokens on request', () => {
    expect(buildUsageCostBreakdown(ROWS, 'model-key', 'calls').priced.map((group) => group.calls)).toEqual([20, 10, 4]);
    expect(buildUsageCostBreakdown(ROWS, 'model-key', 'tokens').priced.map((group) => group.tokens)).toEqual([400, 300, 200]);
  });

  it('labels a missing Key and surfaces only informative references', () => {
    const { priced } = buildUsageCostBreakdown([
      row('gemini-flash-high', null, 1, { reference: 'google/gemini-flash' }),
      row('gpt-5', 'work', 1, { reference: 'openai/gpt-5' }),
    ], 'model');
    expect(priced.find((group) => group.label === 'gemini-flash-high')?.reference).toBe('google/gemini-flash');
    expect(priced.find((group) => group.label === 'gemini-flash-high')?.secondary.values).toEqual([UNKNOWN_KEY_LABEL]);
    expect(priced.find((group) => group.label === 'gpt-5')?.reference).toBeUndefined();
  });
});

describe('splitUsageModelRoute', () => {
  it('splits a router path from the model name', () => {
    expect(splitUsageModelRoute('remote-magpie/kiro/kimi-k3')).toEqual({ route: 'remote-magpie/kiro/', name: 'kimi-k3' });
    expect(splitUsageModelRoute('grok-4.6')).toEqual({ route: '', name: 'grok-4.6' });
    expect(splitUsageModelRoute('odd/')).toEqual({ route: '', name: 'odd/' });
  });
});
