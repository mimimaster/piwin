import { describe, expect, it } from 'vitest';
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
      input: ['text', 'image'],
      reasoning: true,
    });

    expect(createModelConfigurationEntry(draft)).toEqual({
      id: 'deepseek-reasoner',
      label: 'DeepSeek Reasoner',
      contextWindow: 128_000,
      maxOutputTokens: 64_000,
      tooltipMarkdown: 'High-reasoning model.',
      thinkingLevel: 'high',
      input: ['text', 'image'],
      reasoning: true,
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
        supportsImage: false,
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
        supportsImage: false,
        reasoning: true,
      }),
    ).toBeNull();
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
      { id: 'deepseek-chat', contextWindow: 64_000 },
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        input: ['text', 'image'],
        reasoning: true,
        contextWindow: 128_000,
      },
    ]);
  });

  it('modelSupportsImage treats omitted input as text-only', () => {
    expect(modelSupportsImage(undefined)).toBe(false);
    expect(modelSupportsImage({ input: ['text'] })).toBe(false);
    expect(modelSupportsImage({ input: ['text', 'image'] })).toBe(true);
  });
});
