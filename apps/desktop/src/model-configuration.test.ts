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
        supportsRealtimeAudio: false,
        supportsNativeWebSearch: false,
        nativeSearchAdapter: '',
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

  it('round-trips a per-model protocol and clears it when set back to the provider default', () => {
    const gemini: ModelConfigEntry = { id: 'gemini-3.8-flash-high', protocol: 'google-gemini' };
    const draft = createModelConfigurationDraft(gemini);
    expect(draft.protocol).toBe('google-gemini');
    expect(applyModelConfigurationDraft([gemini], gemini.id, draft)?.[0]?.protocol).toBe('google-gemini');

    const inherited = applyModelConfigurationDraft([gemini], gemini.id, { ...draft, protocol: '' });
    expect(inherited?.[0]).not.toHaveProperty('protocol');
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
        supportsRealtimeAudio: false,
        supportsNativeWebSearch: false,
        nativeSearchAdapter: '',
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
        capabilities: ['image-generation', 'chat'],
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
    // Persisted as plain chat rather than an omitted key: settings/apply keeps
    // stored keys the shell omits, which would restore 生图 on the next load.
    expect(next?.[0]?.capabilities).toEqual(['chat']);
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

  it('keeps chat when image generation is added to a chat model', () => {
    const next = applyModelConfigurationDraft(
      [{ id: 'gemini-3.1-pro-low' }],
      'gemini-3.1-pro-low',
      {
        ...createModelConfigurationDraft({ id: 'gemini-3.1-pro-low' }),
        supportsImageGeneration: true,
      },
    );
    expect(next?.[0]?.capabilities).toEqual(['image-generation', 'chat']);
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

    // Same reason as image-generation: an omitted key is resurrected by the
    // Host merge, so the cleared 视频 tag must be replaced explicitly.
    expect(next?.[0]?.capabilities).toEqual(['chat']);
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
    expect(openaiDraft.thinkingLevel).toBe('medium');

    const anthropicDraft = createModelConfigurationDraft(
      { id: 'claude', reasoning: true },
      undefined,
      'anthropic-compatible',
    );
    expect(anthropicDraft.thinkingLevels).toEqual(['low', 'medium', 'high', 'max']);
    expect(anthropicDraft.thinkingLevel).toBe('medium');
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
    expect(draft.supportsImageGeneration).toBe(false);
    expect(draft.supportsVideoGeneration).toBe(false);
    expect(draft.reasoning).toBe(false);
    expect(draft.thinkingLevels).toEqual([]);
    expect(draft.imageApiStyle).toBe('openai');
    expect(draft.imagePath).toBe('/images/generations');
  });

  it('does not re-check image generation from the model id after it was turned off', () => {
    const original: ModelConfigEntry = {
      id: 'gemini-2.5-flash-image',
      capabilities: ['chat', 'image-generation'],
    };
    const next = applyModelConfigurationDraft([original], original.id, {
      ...createModelConfigurationDraft(original),
      supportsImageGeneration: false,
    });
    expect(next?.[0]?.capabilities).toEqual(['chat']);
    expect(createModelConfigurationDraft(next![0]!).supportsImageGeneration).toBe(false);
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

  it('writes an explicit capability list when native search is the last tag cleared', () => {
    // settings/apply merges a replaced model field by field: omitting
    // `capabilities` keeps the stored list, so the cleared tag comes back.
    const original: ModelConfigEntry = {
      id: 'gemini-3.8-flash-high',
      capabilities: ['native-web-search'],
    };
    const models = applyModelConfigurationDraft([original], original.id, {
      ...createModelConfigurationDraft(original),
      supportsNativeWebSearch: false,
      nativeSearchAdapter: '',
    });
    expect(models?.[0]?.capabilities).toEqual(['chat']);
    expect(createModelConfigurationDraft(models![0]!).supportsNativeWebSearch).toBe(false);
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

  it('saves entry with a sensible default thinkingLevel when thinkingLevels is configured', () => {
    const entry = createModelConfigurationEntry({
      id: 'custom-reasoner',
      label: 'Reasoner',
      contextWindow: '128000',
      maxOutputTokens: '8192',
      tooltipMarkdown: '',
      thinkingLevel: '',
      thinkingLevels: ['low', 'medium', 'high', 'max'],
      supportsImage: false,
      supportsImageGeneration: false,
      supportsVideoGeneration: false,
      supportsSpeechToText: false,
      supportsTextToSpeech: false,
      supportsRealtimeAudio: false,
      supportsNativeWebSearch: false,
      nativeSearchAdapter: '',
      reasoning: true,
      ...EMPTY_GENERATION_ROUTE_FIELDS,
    });

    expect(entry?.thinkingLevel).toBe('medium');
    expect(entry?.thinkingLevels).toEqual(['low', 'medium', 'high', 'max']);
  });
});

describe('native search adapter round-trip', () => {
  it('round-trips adapter and options through draft → entry', () => {
    const model = {
      id: 'claude-x',
      capabilities: ['chat' as const, 'native-web-search' as const],
      nativeSearchAdapter: 'anthropic-web-search-tool' as const,
      nativeSearchOptions: { anthropic: { toolType: 'web_search_20260209' as const, allowedCallers: ['direct'] } },
    };
    const draft = createModelConfigurationDraft(model, undefined, 'anthropic-compatible');
    expect(draft.nativeSearchAdapter).toBe('anthropic-web-search-tool');
    const entry = createModelConfigurationEntry(draft);
    expect(entry?.nativeSearchAdapter).toBe('anthropic-web-search-tool');
    expect(entry?.nativeSearchOptions).toEqual(model.nativeSearchOptions);
    const edited = applyModelConfigurationDraft([model], 'claude-x', { ...draft, supportsNativeWebSearch: false });
    expect(edited?.[0]?.nativeSearchAdapter).toBeUndefined();
    expect(edited?.[0]?.nativeSearchOptions).toBeUndefined();
  });

  it('keeps an unknown historical adapter visible in the draft', () => {
    const draft = createModelConfigurationDraft(
      { id: 'm', capabilities: ['chat', 'native-web-search'], nativeSearchAdapter: 'openrouter-plugin' as never },
      undefined,
      'openai-compatible',
    );
    expect(draft.nativeSearchAdapter).toBe('openrouter-plugin');
  });
});
