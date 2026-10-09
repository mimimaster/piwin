import { describe, expect, it } from 'vitest';
import type { ModelCatalogEntry } from './model-catalog.js';
import type { UsageRecord } from './usage.js';
import { estimateUsageCost } from './usage-cost.js';

const model: ModelCatalogEntry = {
  catalogProviderId: 'reference', modelId: 'test-model', name: 'Test', input: ['text'],
  reasoning: true, contextWindow: 200_000, maxTokens: 8_000,
  cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, missingCostFields: [],
};
const usage: UsageRecord = {
  sessionId: 's', projectPath: null, modelId: 'test-model', providerId: 'custom-key',
  promptTokens: 1_000, completionTokens: 100, cacheReadTokens: 2_000, cacheWriteTokens: 500,
  totalTokens: 3_600, reasoningTokens: 80, recordedAt: '2026-10-09T00:00:00Z', source: 'assistant-usage',
};

describe('estimateUsageCost', () => {
  it('prices four normalized categories per million, without charging reasoning twice', () => {
    const cost = estimateUsageCost(usage, model);
    expect(cost?.usd).toBeCloseTo(0.006975, 12);
    expect(cost?.reference).toBe('reference/test-model');
    expect(estimateUsageCost({ ...usage, reasoningTokens: 0 }, model)).toEqual(cost);
  });

  it('keeps an explicitly free model distinct from a legacy all-zero or missing price', () => {
    const free = { ...model, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
    expect(estimateUsageCost(usage, free)?.usd).toBe(0);
    const { missingCostFields: _missing, ...legacy } = free;
    expect(estimateUsageCost(usage, legacy)).toBeUndefined();
    expect(estimateUsageCost(usage, { ...free, missingCostFields: ['input'] })).toBeUndefined();
    expect(estimateUsageCost(usage, undefined)).toBeUndefined();
  });

  it('does not price a consumed category with a missing rate, but ignores unused categories', () => {
    const noCacheWrite = { ...model, missingCostFields: ['cacheWrite'] as const };
    expect(estimateUsageCost(usage, noCacheWrite)).toBeUndefined();
    expect(estimateUsageCost({ ...usage, cacheWriteTokens: 0, totalTokens: 3_100 }, noCacheWrite)?.usd)
      .toBeCloseTo(0.0051, 12);
  });

  it('does not invent a token split or price incomplete totals / Host estimates', () => {
    const { promptTokens: _prompt, ...noPrompt } = usage;
    expect(estimateUsageCost(noPrompt, model)).toBeUndefined();
    expect(estimateUsageCost({ ...usage, totalTokens: 4_000 }, model)).toBeUndefined();
    expect(estimateUsageCost({ ...usage, source: 'host-estimate' }, model)).toBeUndefined();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid counts or rates (%s)', (invalid) => {
    expect(estimateUsageCost({ ...usage, completionTokens: invalid }, model)).toBeUndefined();
    expect(estimateUsageCost({ ...usage, totalTokens: invalid }, model)).toBeUndefined();
    expect(estimateUsageCost(usage, { ...model, cost: { ...model.cost, output: invalid } })).toBeUndefined();
  });

  it('treats malformed stored price data as unknown instead of failing the usage command', () => {
    const { cost: _cost, ...noCost } = model;
    expect(estimateUsageCost(usage, noCost as ModelCatalogEntry)).toBeUndefined();
    expect(estimateUsageCost(usage, { ...model, missingCostFields: 0 } as unknown as ModelCatalogEntry)).toBeUndefined();
  });

  it('rejects overflow rather than returning an infinite currency value', () => {
    expect(estimateUsageCost(usage, { ...model, cost: { ...model.cost, input: Number.MAX_VALUE } })).toBeUndefined();
  });
});
