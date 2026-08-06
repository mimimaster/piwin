import { describe, expect, it } from 'vitest';
import type { ModelCatalogEntry } from '@piwin/contracts';
import {
  applyModelConfigurationDraft,
  createModelConfigurationDraft,
  createModelConfigurationEntry,
  mergeDiscoveredModels,
  modelSupportsImage,
} from './model-configuration';

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
      capabilities: ['image-generation'],
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
      capabilities: ['image-generation'],
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
        reasoning: true,
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
        reasoning: true,
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
    const models = [
      {
        id: 'image-reasoner',
        routes: {
          'image-generation': { path: '/images/custom', timeoutMs: 90_000 },
        },
      },
    ];
    const next = applyModelConfigurationDraft(models, 'image-reasoner', {
      ...createModelConfigurationDraft({ id: 'image-reasoner' }),
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
          'image-generation': { path: '/images/custom', timeoutMs: 90_000 },
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

  it('preserves video-generation when the shared model editor saves image settings', () => {
    const next = applyModelConfigurationDraft(
      [{ id: 'multimodal-model', capabilities: ['video-generation'] }],
      'multimodal-model',
      {
        ...createModelConfigurationDraft({ id: 'multimodal-model' }),
        supportsImageGeneration: true,
      },
    );

    expect(next?.[0]?.capabilities).toEqual(['video-generation', 'image-generation']);
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

  it('prefers explicit thinkingLevels over protocol defaults in the draft', () => {
    const draft = createModelConfigurationDraft(
      { id: 'gpt-4o', reasoning: true, thinkingLevels: ['off', 'high'] },
      undefined,
      'openai-compatible',
    );
    expect(draft.thinkingLevels).toEqual(['off', 'high']);
  });
});
