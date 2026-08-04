import { describe, expect, it } from 'vitest';
import {
  filterSuggestions,
  matchImageCatalog,
  splitModelName,
} from './image-model-suggest.js';
import type { ImageModelCatalogEntry } from '@piwin/contracts';

const catalog: ImageModelCatalogEntry[] = [
  { catalogProviderId: 'openrouter', modelId: 'openai/gpt-image-1', name: 'OpenAI GPT Image 1', input: ['text', 'image'], output: ['image'] },
  { catalogProviderId: 'openrouter', modelId: 'google/gemini-3-pro-image', name: 'Gemini 3 Pro Image', input: ['image', 'text'], output: ['image', 'text'] },
  { catalogProviderId: 'openrouter', modelId: 'black-forest-labs/flux.2-pro', name: 'FLUX.2 Pro', input: ['text', 'image'], output: ['image'] },
  { catalogProviderId: 'openrouter', modelId: 'recraft/recraft-v3', name: 'Recraft V3', input: ['text', 'image'], output: ['image'] },
];

describe('splitModelName', () => {
  it('extracts the segment after the last slash', () => {
    expect(splitModelName('openai/gpt-image-1')).toBe('gpt-image-1');
    expect(splitModelName('black-forest-labs/flux.2-pro')).toBe('flux.2-pro');
  });

  it('returns the id as-is when there is no slash', () => {
    expect(splitModelName('gpt-image-1')).toBe('gpt-image-1');
  });
});

describe('matchImageCatalog', () => {
  it('matches by split name when discovered ids lack the provider prefix', () => {
    const discovered = ['gpt-image-1', 'gemini-3-pro-image'];
    const result = matchImageCatalog(catalog, discovered);
    expect(result.matched).toHaveLength(2);
    expect(result.matched[0]!.entry.modelId).toBe('openai/gpt-image-1');
    expect(result.matched[0]!.matchedId).toBe('gpt-image-1');
    expect(result.matched[1]!.entry.modelId).toBe('google/gemini-3-pro-image');
    expect(result.matched[1]!.matchedId).toBe('gemini-3-pro-image');
    expect(result.unmatched).toHaveLength(2);
    expect(result.unmatched[0]!.modelId).toBe('black-forest-labs/flux.2-pro');
    expect(result.unmatched[1]!.modelId).toBe('recraft/recraft-v3');
  });

  it('matches by full id when discovered ids include the provider prefix', () => {
    const discovered = ['openai/gpt-image-1', 'recraft/recraft-v3'];
    const result = matchImageCatalog(catalog, discovered);
    expect(result.matched).toHaveLength(2);
    expect(result.matched[0]!.entry.modelId).toBe('openai/gpt-image-1');
    expect(result.matched[0]!.matchedId).toBe('openai/gpt-image-1');
    expect(result.matched[1]!.entry.modelId).toBe('recraft/recraft-v3');
  });

  it('preserves catalog order in both matched and unmatched', () => {
    const discovered = ['recraft-v3', 'flux.2-pro'];
    const result = matchImageCatalog(catalog, discovered);
    // matched should be in catalog order: flux.2-pro (index 2), recraft-v3 (index 3)
    expect(result.matched[0]!.entry.modelId).toBe('black-forest-labs/flux.2-pro');
    expect(result.matched[1]!.entry.modelId).toBe('recraft/recraft-v3');
    // unmatched should be in catalog order: gpt-image-1 (index 0), gemini (index 1)
    expect(result.unmatched[0]!.modelId).toBe('openai/gpt-image-1');
    expect(result.unmatched[1]!.modelId).toBe('google/gemini-3-pro-image');
  });

  it('returns all unmatched when discovered list is empty', () => {
    const result = matchImageCatalog(catalog, []);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(4);
  });

  it('is case-insensitive', () => {
    const discovered = ['GPT-IMAGE-1'];
    const result = matchImageCatalog(catalog, discovered);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.entry.modelId).toBe('openai/gpt-image-1');
  });
});

describe('filterSuggestions', () => {
  it('returns all entries when query is empty', () => {
    expect(filterSuggestions(catalog, '')).toHaveLength(4);
  });

  it('filters by modelId substring', () => {
    const filtered = filterSuggestions(catalog, 'gpt');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.modelId).toBe('openai/gpt-image-1');
  });

  it('filters by name substring', () => {
    const filtered = filterSuggestions(catalog, 'flux');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.modelId).toBe('black-forest-labs/flux.2-pro');
  });

  it('preserves order', () => {
    const filtered = filterSuggestions(catalog, 'image');
    // gpt-image-1, gemini-3-pro-image
    expect(filtered[0]!.modelId).toBe('openai/gpt-image-1');
    expect(filtered[1]!.modelId).toBe('google/gemini-3-pro-image');
  });
});
