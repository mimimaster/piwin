import { describe, expect, it } from 'vitest';
import type { ModelCatalogEntry, ModelConfigEntry } from '@piwin/contracts';
import { EMPTY_GENERATION_ROUTE_FIELDS } from './generation-route-defaults';
import {
  applyModelConfigurationDraft,
  createModelConfigurationDraft,
  createModelConfigurationEntry,
  mergeDiscoveredModels,
  modelSupportsImage,
} from './model-configuration';
import { collectVideoModels } from './video-generation-model-config';

describe('model configuration', () => {
  it('round-trips all per-model configuration fields including input/reasoning', () => {
    const draft = createModelConfigurationDraft({
      id: 'deepseek-reasoner',
      label: 'DeepSeek Reasoner',
      contextWindow: 128_000,
      maxOutputTokens: 64_000,
      tooltipMarkdown: 'High-reasoning model.',
      thinkingLevel: 'high',
      thinkingLevels: ['off', 'low', 'medium', 'high'],
      input: ['text', 'image'],
      reasoning: true,
      capabilities: ['image-generation', 'video-generation'],
    });

    expect(createModelConfigurationEntry(draft)).toEqual({
      id: 'deepseek-reasoner',
      label: 'DeepSeek Reasoner',
      contextWindow: 128_000,
      maxOutputTokens: 64_000,
      tooltipMarkdown: 'High-reasoning model.',
      thinkingLevel: 'high',
      thinkingLevels: ['off', 'low', 'medium', 'high'],
      input: ['text', 'image'],
      reasoning: true,
      capabilities: ['image-generation', 'video-generation'],
      routes: {
        'image-generation': { apiStyle: 'openai', path: '/images/generations' },
        'video-generation': { apiStyle: 'openai-videos', path: '/videos' },
      },
    });
  });

  it('does not persist empty or invalid optional limits', () => {
    expect(
      createModelConfigurationEntry({
        id: 'custom-model',
        label: ' custom-model ',
        contextWindow: '0',
        maxOutputTokens: 'not-a-number',
        tooltipMarkdown: '   ',
        thinkingLevel: '',
        thinkingLevels: [],
        supportsImage: false,
        supportsImageGeneration: false,
        supportsVideoGeneration: false,
        supportsSpeechToText: false,
        supportsTextToSpeech: false,
        supportsNativeWebSearch: false,
        reasoning: true,
        ...EMPTY_GENERATION_ROUTE_FIELDS,
      }),
    ).toEqual({
      id: 'custom-model',
      input: ['text'],
      reasoning: true,
    });
  });

  it('applies edited runtime limits onto the model list', () => {
    const reasoner = { id: 'deepseek-reasoner' };
    const models = [{ id: 'deepseek-chat' }, reasoner];

    const next = applyModelConfigurationDraft(models, 'deepseek-reasoner', {
      ...createModelConfigurationDraft(reasoner),
      contextWindow: '128000',
      maxOutputTokens: '64000',
    });

    expect(next).toEqual([
      { id: 'deepseek-chat' },
      {
        id: 'deepseek-reasoner',
        contextWindow: 128_000,
        maxOutputTokens: 64_000,
        input: ['text'],
        reasoning: true,
      },
    ]);
  });

  it('clearing limit inputs removes the fields so provider defaults apply', () => {
    const reasoner = { id: 'deepseek-reasoner', contextWindow: 128_000, maxOutputTokens: 64_000 };

    const next = applyModelConfigurationDraft([reasoner], 'deepseek-reasoner', {
      ...createModelConfigurationDraft(reasoner),
      contextWindow: '',
      maxOutputTokens: '',
    });

    expect(next).toEqual([{ id: 'deepseek-reasoner', input: ['text'], reasoning: true }]);
  });

  it('rejects drafts with a blank model id without touching the list', () => {
    const models = [{ id: 'deepseek-chat' }];
    expect(
      applyModelConfigurationDraft(models, 'deepseek-chat', {
        id: '   ',
        label: '',
        contextWindow: '',
        maxOutputTokens: '',
        tooltipMarkdown: '',
        thinkingLevel: '',
        thinkingLevels: [],
        supportsImage: false,
        supportsImageGeneration: false,
        supportsVideoGeneration: false,
        supportsSpeechToText: false,
        supportsTextToSpeech: false,
        supportsNativeWebSearch: false,
        reasoning: true,
        ...EMPTY_GENERATION_ROUTE_FIELDS,
      }),
    ).toBeNull();
  });

  it('uses catalog limits and modalities only when the model omitted them', () => {
    const catalog: ModelCatalogEntry = {
      catalogProviderId: 'openai',
      modelId: 'gpt-test',
      name: 'GPT Test',
      input: ['text', 'image'],
      reasoning: true,
      contextWindow: 200_000,
      maxTokens: 32_000,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const draft = createModelConfigurationDraft({ id: 'gpt-test' }, catalog);
    expect(draft.contextWindow).toBe('200000');
    expect(draft.maxOutputTokens).toBe('32000');
    expect(draft.supportsImage).toBe(true);
    expect(draft.reasoning).toBe(true);
  });

  it('round-trips max effort and image-generation capability while preserving its route', () => {
    const original = {
      id: 'image-reasoner',
      routes: {
        'image-generation': { path: '/images/custom', timeoutMs: 90_000 },
      },
    };
    const next = applyModelConfigurationDraft([original], 'image-reasoner', {
      ...createModelConfigurationDraft(original),
      thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
      thinkingLevel: 'max',
      supportsImage: true,
      supportsImageGeneration: true,
      reasoning: true,
    });
    expect(next).toEqual([
      {
        id: 'image-reasoner',
        contextWindow: 128_000,
        maxOutputTokens: 8_192,
        input: ['text', 'image'],
        reasoning: true,
        thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
        thinkingLevel: 'max',
        capabilities: ['image-generation'],
        routes: {
          'image-generation': {
            apiStyle: 'openai',
            path: '/images/custom',
            timeoutMs: 90_000,
          },
        },
      },
    ]);
  });

  it('removes image-generation when the capability is unchecked', () => {
    const next = applyModelConfigurationDraft(
      [{ id: 'image-model', capabilities: ['image-generation'] }],
      'image-model',
      {
        ...createModelConfigurationDraft({ id: 'image-model' }),
        supportsImageGeneration: false,
      },
    );
    expect(next?.[0]?.capabilities).toBeUndefined();
  });

  it('round-trips video-generation from the shared model editor', () => {
    const model: ModelConfigEntry = {
      id: 'multimodal-model',
      capabilities: ['video-generation'],
    };
    const next = applyModelConfigurationDraft(
      [model],
      'multimodal-model',
      {
        ...createModelConfigurationDraft(model),
        supportsImageGeneration: true,
      },
    );

    expect(next?.[0]?.capabilities).toEqual(['image-generation', 'video-generation']);
  });

  it('removes video-generation when the capability is unchecked', () => {
    const next = applyModelConfigurationDraft(
      [{ id: 'video-model', capabilities: ['video-generation'] }],
      'video-model',
      {
        ...createModelConfigurationDraft({
          id: 'video-model',
          capabilities: ['video-generation'],
        }),
        supportsVideoGeneration: false,
      },
    );

    expect(next?.[0]?.capabilities).toBeUndefined();
  });

  it('makes a newly tagged model available to Video settings automatically', () => {
    const model = createModelConfigurationEntry({
      ...createModelConfigurationDraft({ id: 'grok-imagine-video' }),
      supportsVideoGeneration: true,
    });
    expect(model).not.toBeNull();

    const rows = collectVideoModels([
      {
        id: 'xai',
        name: 'xAI',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.x.ai/v1',
        models: model ? [model] : [],
      },
    ]);

    expect(rows.map(({ provider, model: videoModel }) => [provider.id, videoModel.id])).toEqual([
      ['xai', 'grok-imagine-video'],
    ]);
  });

  it('imports discovered models with catalog-enriched input fields', () => {
    const models = mergeDiscoveredModels(
      [{ id: 'deepseek-chat', contextWindow: 64_000 }],
      [
        { id: 'deepseek-chat', label: 'DeepSeek Chat' },
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          input: ['text', 'image'],
          reasoning: true,
          contextWindow: 128_000,
        },
      ],
    );

    expect(models).toEqual([
      { id: 'deepseek-chat', contextWindow: 64_000, label: 'DeepSeek Chat' },
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        input: ['text', 'image'],
        reasoning: true,
        contextWindow: 128_000,
      },
    ]);
  });

  it('re-import fills missing fields without overwriting existing config', () => {
    const models = mergeDiscoveredModels(
      [
        {
          id: 'grok-4.5',
          label: 'My Grok',
          contextWindow: 32_000,
        },
      ],
      [
        {
          id: 'grok-4.5',
          label: 'Grok 4.5',
          input: ['text', 'image'],
          reasoning: true,
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
        },
      ],
    );

    expect(models).toEqual([
      {
        id: 'grok-4.5',
        label: 'My Grok',
        contextWindow: 32_000,
        input: ['text', 'image'],
        reasoning: true,
        maxOutputTokens: 8_192,
      },
    ]);
  });

  it('carries image-generation capability from discovered models into the entry', () => {
    const models = mergeDiscoveredModels(
      [],
      [
        {
          id: 'gpt-image-1',
          capabilities: ['image-generation'],
          input: ['text', 'image'],
        },
      ],
    );

    expect(models).toEqual([
      {
        id: 'gpt-image-1',
        capabilities: ['image-generation'],
        input: ['text', 'image'],
        routes: {
          'image-generation': { apiStyle: 'openai', path: '/images/generations' },
        },
      },
    ]);
  });

  it('unions discovered capabilities into an existing entry without dropping tags', () => {
    const models = mergeDiscoveredModels(
      [{ id: 'gpt-image-1', capabilities: ['video-generation'] }],
      [{ id: 'gpt-image-1', capabilities: ['image-generation'] }],
    );

    expect(models).toEqual([
      {
        id: 'gpt-image-1',
        capabilities: ['video-generation', 'image-generation'],
        routes: {
          'video-generation': { apiStyle: 'openai-videos', path: '/videos' },
          'image-generation': { apiStyle: 'openai', path: '/images/generations' },
        },
      },
    ]);
  });

  it('modelSupportsImage treats omitted input as text-only', () => {
    expect(modelSupportsImage(undefined)).toBe(false);
    expect(modelSupportsImage({ input: ['text'] })).toBe(false);
    expect(modelSupportsImage({ input: ['text', 'image'] })).toBe(true);
  });

  it('defaults thinking levels based on protocol when none are configured', () => {
    const openaiDraft = createModelConfigurationDraft(
      { id: 'gpt-4o', reasoning: true },
      undefined,
      'openai-compatible',
    );
    expect(openaiDraft.thinkingLevels).toEqual(['low', 'medium', 'high', 'xhigh']);

    const anthropicDraft = createModelConfigurationDraft(
      { id: 'claude', reasoning: true },
      undefined,
      'anthropic-compatible',
    );
    expect(anthropicDraft.thinkingLevels).toEqual(['low', 'medium', 'high', 'max']);
  });

  it('stamps grok imagine video wire format even on an Anthropic-protocol channel', () => {
    const draft = createModelConfigurationDraft(
      { id: 'grok-imagine-video' },
      undefined,
      'anthropic-compatible',
    );
    expect(draft.supportsVideoGeneration).toBe(true);
    expect(draft.videoApiStyle).toBe('xgrok-videos');
    expect(draft.videoPath).toBe('/videos/generations');
    expect(createModelConfigurationEntry(draft)?.routes).toEqual({
      'video-generation': { apiStyle: 'xgrok-videos', path: '/videos/generations' },
    });
  });

  it('does not treat untagged Grok Imagine image ids as chat reasoners', () => {
    const draft = createModelConfigurationDraft(
      { id: 'grok-imagine-image-lite' },
      undefined,
      'anthropic-compatible',
    );
    expect(draft.supportsImageGeneration).toBe(true);
    expect(draft.supportsVideoGeneration).toBe(false);
    expect(draft.reasoning).toBe(false);
    expect(draft.thinkingLevels).toEqual([]);
    expect(draft.imageApiStyle).toBe('openai');
    expect(draft.imagePath).toBe('/images/generations');
  });

  it('prefers explicit thinkingLevels over protocol defaults in the draft', () => {
    const draft = createModelConfigurationDraft(
      { id: 'gpt-4o', reasoning: true, thinkingLevels: ['off', 'high'] },
      undefined,
      'openai-compatible',
    );
    expect(draft.thinkingLevels).toEqual(['off', 'high']);
  });

  it('round-trips native web search capability', () => {
    const draft = createModelConfigurationDraft({
      id: 'search-model',
      capabilities: ['native-web-search'],
    });

    expect(draft.supportsNativeWebSearch).toBe(true);
    expect(createModelConfigurationEntry(draft)).toEqual({
      id: 'search-model',
      capabilities: ['native-web-search'],
      input: ['text'],
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      reasoning: true,
    });
  });

  it('removes stale native-search metadata when saving a model', () => {
    const original = {
      id: 'search-model',
      capabilities: ['native-web-search', 'video-generation'],
      routes: {
        'video-generation': { apiStyle: 'custom' },
      },
      nativeWebSearchMode: 'legacy',
    } as ModelConfigEntry & { nativeWebSearchMode: 'legacy' };
    const draft = createModelConfigurationDraft({
      ...original,
      capabilities: ['video-generation'],
    });
    draft.supportsNativeWebSearch = false;

    const models = applyModelConfigurationDraft([original], original.id, draft);
    expect(models?.[0]?.capabilities).toEqual(['video-generation']);
    expect(models?.[0]?.routes).toEqual({
      'video-generation': { apiStyle: 'custom', path: '/video/generations' },
    });
    expect(models?.[0]).not.toHaveProperty('nativeWebSearchMode');
  });

  it('strips generation routes when the capability is unchecked in the provider editor', () => {
    const next = applyModelConfigurationDraft(
      [
        {
          id: 'hybrid',
          capabilities: ['image-generation', 'video-generation'],
          routes: {
            'image-generation': { path: '/images/generations' },
            'video-generation': { apiStyle: 'custom' },
          },
        },
      ],
      'hybrid',
      {
        ...createModelConfigurationDraft({
          id: 'hybrid',
          capabilities: ['image-generation', 'video-generation'],
          routes: {
            'image-generation': { path: '/images/generations' },
            'video-generation': { apiStyle: 'custom' },
          },
        }),
        supportsImageGeneration: false,
        supportsVideoGeneration: true,
      },
    );

    expect(next?.[0]?.capabilities).toEqual(['video-generation']);
    expect(next?.[0]?.routes).toEqual({
      'video-generation': { apiStyle: 'custom', path: '/video/generations' },
    });
  });
});
