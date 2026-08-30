import { describe, expect, it } from 'vitest';
import {
  enrichFromCatalog,
  lookupCatalogByModelId,
  searchPiCatalog,
} from './model-catalog-reader.js';

describe('model-catalog-reader', () => {
  it('searches by model id substring and clamps limit', () => {
    const result = searchPiCatalog({ query: 'gpt', limit: 5 });
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.entries.length).toBeLessThanOrEqual(5);
    expect(result.catalogVersion).toBeTruthy();
    for (const entry of result.entries) {
      const haystack = `${entry.modelId} ${entry.name}`.toLowerCase();
      expect(haystack.includes('gpt')).toBe(true);
    }
  });

  it('filters by inputIncludes image', () => {
    const result = searchPiCatalog({ inputIncludes: 'image', limit: 20 });
    expect(result.entries.length).toBeGreaterThan(0);
    for (const entry of result.entries) {
      expect(entry.input).toContain('image');
    }
  });

  it('looks up catalog entry by model id', () => {
    const sample = searchPiCatalog({ limit: 1 }).entries[0];
    expect(sample).toBeDefined();
    if (!sample) return;
    const found = lookupCatalogByModelId(sample.modelId);
    expect(found?.modelId).toBe(sample.modelId);
  });

  it('looks up grok-4.6 by a gateway-prefixed id', () => {
    const found = lookupCatalogByModelId('custom-openai/grok-4.6');
    expect(found?.modelId).toBe('grok-4.6');
    expect(found?.contextWindow).toBe(500_000);
  });

  it('enrichFromCatalog fills missing fields without overwriting', () => {
    const catalog = {
      catalogProviderId: 'openai',
      modelId: 'gpt-test',
      name: 'GPT Test',
      input: ['text', 'image'] as const,
      reasoning: true,
      contextWindow: 200_000,
      maxTokens: 16_384,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const enriched = enrichFromCatalog(
      { id: 'gpt-test', contextWindow: 99_000 },
      catalog,
    );
    expect(enriched.contextWindow).toBe(99_000);
    expect(enriched.input).toEqual(['text', 'image']);
    expect(enriched.reasoning).toBe(true);
    expect(enriched.maxOutputTokens).toBe(16_384);
  });
});
