import { describe, expect, it } from 'vitest';
import { projectModelsDevApi } from './models-dev-map.js';

const fixture = {
  xai: {
    id: 'xai',
    name: 'xAI',
    models: {
      'grok-4.6': {
        id: 'grok-4.6',
        name: 'Grok 4.6',
        reasoning: true,
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 500_000, output: 32_768 },
        cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
      },
      'grok-imagine-image': {
        id: 'grok-imagine-image',
        name: 'Grok Imagine Image',
        reasoning: false,
        modalities: { input: ['text', 'image'], output: ['image'] },
        limit: { context: 8_000, output: 0 },
        cost: { input: 0, output: 0 },
      },
    },
  },
  skipme: { models: { bad: { name: 'no-id' } } },
};

describe('projectModelsDevApi', () => {
  it('maps chat limits, modalities, cost, and image output rows', () => {
    const { entries, imageEntries } = projectModelsDevApi(fixture);
    expect(entries.map((entry) => entry.modelId)).toEqual(['grok-4.6', 'grok-imagine-image']);
    const grok = entries[0];
    expect(grok).toMatchObject({
      catalogProviderId: 'xai',
      modelId: 'grok-4.6',
      name: 'Grok 4.6',
      input: ['text', 'image'],
      reasoning: true,
      contextWindow: 500_000,
      maxTokens: 32_768,
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
    });
    expect(imageEntries).toEqual([
      {
        catalogProviderId: 'xai',
        modelId: 'grok-imagine-image',
        name: 'Grok Imagine Image',
        input: ['text', 'image'],
        output: ['image'],
      },
    ]);
  });

  it('returns empty arrays for non-objects', () => {
    expect(projectModelsDevApi(null)).toEqual({ entries: [], imageEntries: [] });
    expect(projectModelsDevApi('nope')).toEqual({ entries: [], imageEntries: [] });
  });
});
