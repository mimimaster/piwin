import { afterEach, describe, expect, it } from 'vitest';
import {
  enrichFromCatalog,
  getModelCatalogStatus,
  installModelCatalogSnapshot,
  lookupCatalogByModelId,
  resetModelCatalogSnapshot,
  searchPiCatalog,
  searchPiImagesCatalog,
} from './model-catalog-reader.js';

afterEach(() => {
  resetModelCatalogSnapshot();
});

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

  it('installs a snapshot that replaces Pi bootstrap search and lookup', () => {
    const bootstrap = getModelCatalogStatus();
    expect(bootstrap.source).toBe('pi-bootstrap');

    installModelCatalogSnapshot({
      source: 'models.dev',
      catalogVersion: 'models.dev@test',
      fetchedAt: '2026-09-21T00:00:00.000Z',
      entries: [
        {
          catalogProviderId: 'xai',
          modelId: 'piwin-catalog-unique-id',
          name: 'Unique Test Model',
          input: ['text'],
          reasoning: true,
          contextWindow: 42_000,
          maxTokens: 1_024,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      imageEntries: [
        {
          catalogProviderId: 'xai',
          modelId: 'piwin-image-unique-id',
          name: 'Unique Image Model',
          input: ['text'],
          output: ['image'],
        },
      ],
    });

    const status = getModelCatalogStatus();
    expect(status).toEqual({
      source: 'models.dev',
      catalogVersion: 'models.dev@test',
      fetchedAt: '2026-09-21T00:00:00.000Z',
      entryCount: 1,
      imageEntryCount: 1,
    });

    const search = searchPiCatalog({ query: 'piwin-catalog-unique', limit: 5 });
    expect(search.catalogVersion).toBe('models.dev@test');
    expect(search.entries.map((entry) => entry.modelId)).toEqual(['piwin-catalog-unique-id']);
    expect(lookupCatalogByModelId('gateway/piwin-catalog-unique-id')?.contextWindow).toBe(42_000);
    expect(searchPiImagesCatalog().entries.map((entry) => entry.modelId)).toEqual([
      'piwin-image-unique-id',
    ]);

    resetModelCatalogSnapshot();
    expect(getModelCatalogStatus().source).toBe('pi-bootstrap');
    expect(lookupCatalogByModelId('piwin-catalog-unique-id')).toBeUndefined();
    expect(lookupCatalogByModelId('custom-openai/grok-4.6')?.modelId).toBe('grok-4.6');
  });
});
