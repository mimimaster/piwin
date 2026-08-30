import { describe, expect, it } from 'vitest';
import {
  filterSuggestions,
  isLikelyImageGenerationModel,
  isLikelyRealtimeAudioModel,
  isLikelyVideoGenerationModel,
  lookupImageGenerationRegistry,
  lookupVideoGenerationRegistry,
  matchImageCatalog,
  splitModelName,
} from './model-catalog.js';
import type { ImageModelCatalogEntry } from './model-catalog.js';

const catalog: ImageModelCatalogEntry[] = [
  {
    catalogProviderId: 'openrouter',
    modelId: 'openai/gpt-image-1',
    name: 'OpenAI GPT Image 1',
    input: ['text', 'image'],
    output: ['image'],
  },
  {
    catalogProviderId: 'openrouter',
    modelId: 'google/gemini-3-pro-image',
    name: 'Gemini 3 Pro Image',
    input: ['image', 'text'],
    output: ['image', 'text'],
  },
  {
    catalogProviderId: 'openrouter',
    modelId: 'black-forest-labs/flux.2-pro',
    name: 'FLUX.2 Pro',
    input: ['text', 'image'],
    output: ['image'],
  },
  {
    catalogProviderId: 'openrouter',
    modelId: 'recraft/recraft-v3',
    name: 'Recraft V3',
    input: ['text', 'image'],
    output: ['image'],
  },
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
    expect(result.discoveredOnly).toHaveLength(0);
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
    expect(result.discoveredOnly).toHaveLength(0);
    expect(result.unmatched).toHaveLength(4);
  });

  it('is case-insensitive', () => {
    const discovered = ['GPT-IMAGE-1'];
    const result = matchImageCatalog(catalog, discovered);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.entry.modelId).toBe('openai/gpt-image-1');
  });

  it('family-matches SiliconFlow FLUX ids that differ from OpenRouter catalog ids', () => {
    const discovered = ['black-forest-labs/FLUX.1-schnell', 'deepseek-chat'];
    const result = matchImageCatalog(catalog, discovered);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.entry.modelId).toBe('black-forest-labs/flux.2-pro');
    expect(result.matched[0]!.matchedId).toBe('black-forest-labs/FLUX.1-schnell');
    // Chat models must not appear as discovered-only image suggestions.
    expect(result.discoveredOnly.map((item) => item.modelId)).not.toContain('deepseek-chat');
  });

  it('surfaces image-like discovered models that are not in the Pi catalog', () => {
    const discovered = [
      'Kwai-Kolors/Kolors',
      'Qwen/Qwen-Image',
      'deepseek-chat',
      'Pro/black-forest-labs/FLUX.1-dev',
    ];
    const result = matchImageCatalog(catalog, discovered, {
      labelsById: {
        'Kwai-Kolors/Kolors': 'Kolors',
        'Qwen/Qwen-Image': 'Qwen Image',
      },
    });
    // FLUX.1-dev family-matches flux.2-pro; the rest of image-like ids are discoveredOnly.
    expect(result.matched.some((item) => item.matchedId.includes('FLUX'))).toBe(true);
    const discoveredOnlyIds = result.discoveredOnly.map((item) => item.modelId);
    expect(discoveredOnlyIds).toEqual(
      expect.arrayContaining(['Kwai-Kolors/Kolors', 'Qwen/Qwen-Image']),
    );
    expect(discoveredOnlyIds).not.toContain('deepseek-chat');
  });
});

describe('isLikelyImageGenerationModel', () => {
  it('detects common gateway image model ids', () => {
    expect(isLikelyImageGenerationModel('black-forest-labs/FLUX.1-schnell')).toBe(true);
    expect(isLikelyImageGenerationModel('Kwai-Kolors/Kolors')).toBe(true);
    expect(isLikelyImageGenerationModel('Qwen/Qwen-Image')).toBe(true);
    expect(isLikelyImageGenerationModel('grok-imagine-image-lite')).toBe(true);
    expect(isLikelyImageGenerationModel('deepseek-chat')).toBe(false);
    expect(isLikelyImageGenerationModel('gpt-4o')).toBe(false);
    expect(isLikelyImageGenerationModel('grok-imagine-video')).toBe(false);
    expect(isLikelyImageGenerationModel('custom-model', 'Custom', ['image-generation'])).toBe(true);
  });
});

describe('isLikelyRealtimeAudioModel', () => {
  it('detects OpenAI-protocol realtime voice ids', () => {
    expect(isLikelyRealtimeAudioModel('grok-voice-think-fast-2.0')).toBe(true);
    expect(isLikelyRealtimeAudioModel('gpt-4o-realtime-preview')).toBe(true);
    expect(isLikelyRealtimeAudioModel('gpt-realtime')).toBe(true);
    expect(isLikelyRealtimeAudioModel('deepseek-chat')).toBe(false);
    expect(isLikelyRealtimeAudioModel('gpt-4o')).toBe(false);
    expect(isLikelyRealtimeAudioModel('whisper-1')).toBe(false);
    expect(isLikelyRealtimeAudioModel('grok-stt')).toBe(false);
    expect(isLikelyRealtimeAudioModel('custom-rt', 'Custom', ['realtime-audio'])).toBe(true);
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

describe('video generation discovery helpers', () => {
  it('matches Sora registry metadata for an OpenAI-compatible model', () => {
    expect(lookupVideoGenerationRegistry('sora-2', 'openai-compatible')).toMatchObject({
      entry: {
        apiStyle: 'openai-videos',
        path: '/videos',
        label: 'Sora 2',
      },
      matchKind: 'exact',
    });
  });

  it('matches Veo registry metadata for a Google model alias', () => {
    expect(lookupVideoGenerationRegistry('veo-3', 'google-gemini')).toMatchObject({
      entry: {
        apiStyle: 'google-veo',
        path: '/models/{model}:predictLongRunning',
        label: 'Google Veo',
      },
      matchKind: 'alias',
    });
  });

  it('matches Grok Imagine video on any protocol so mixed gateways still tag it', () => {
    expect(lookupVideoGenerationRegistry('grok-imagine-video', 'anthropic-compatible')).toMatchObject({
      entry: {
        apiStyle: 'xgrok-videos',
        path: '/videos/generations',
        label: 'Grok Imagine Video',
      },
      matchKind: 'exact',
    });
  });

  it('keeps Sora on the OpenAI Videos adapter even when the channel is Anthropic', () => {
    expect(lookupVideoGenerationRegistry('sora-2', 'anthropic-compatible')).toMatchObject({
      entry: { apiStyle: 'openai-videos', path: '/videos' },
    });
  });

  it('matches grok-imagine-video version suffixes', () => {
    expect(lookupVideoGenerationRegistry('grok-imagine-video-1.5-preview')).toMatchObject({
      entry: { apiStyle: 'xgrok-videos', path: '/videos/generations' },
    });
  });
});

describe('image generation registry', () => {
  it('uses OpenAI images for Grok Imagine image ids', () => {
    expect(lookupImageGenerationRegistry('grok-imagine-image-quality-lite')).toMatchObject({
      entry: { apiStyle: 'openai', path: '/images/generations' },
    });
  });

  it('uses Gemini native for Gemini image ids on an OpenAI-compatible channel', () => {
    expect(
      lookupImageGenerationRegistry('gemini-3.1-flash-image', 'openai-compatible'),
    ).toMatchObject({
      entry: { apiStyle: 'gemini' },
    });
  });

  it('uses Imagen for Imagen ids', () => {
    expect(lookupImageGenerationRegistry('imagen-4.0-generate-001', 'google-gemini')).toMatchObject({
      entry: { apiStyle: 'imagen' },
    });
  });
});

describe('video generation name heuristics', () => {
  it('recognizes generation-oriented heuristic names', () => {
    expect(isLikelyVideoGenerationModel('kling-v1')).toBe(true);
    expect(isLikelyVideoGenerationModel('pika-1.0')).toBe(true);
    expect(isLikelyVideoGenerationModel('grok-imagine-video')).toBe(true);
    expect(isLikelyVideoGenerationModel('grok-imagine-image-lite')).toBe(false);
  });

  it('does not treat video-understanding names as video generation', () => {
    expect(isLikelyVideoGenerationModel('video-understanding-model')).toBe(false);
    expect(isLikelyVideoGenerationModel('vision-video-chat')).toBe(false);
    expect(isLikelyVideoGenerationModel('video-model')).toBe(false);
  });
});
