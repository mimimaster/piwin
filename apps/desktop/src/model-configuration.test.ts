import { describe, expect, it } from 'vitest';
import {
  applyModelConfigurationDraft,
  createModelConfigurationDraft,
  createModelConfigurationEntry,
  mergeDiscoveredModels,
} from './model-configuration';

describe('model configuration', () => {
  it('round-trips all per-model configuration fields', () => {
    const draft = createModelConfigurationDraft({
      id: 'deepseek-reasoner',
      label: 'DeepSeek Reasoner',
      contextWindow: 128_000,
      maxOutputTokens: 64_000,
      tooltipMarkdown: 'High-reasoning model.',
    });

    expect(createModelConfigurationEntry(draft)).toEqual({
      id: 'deepseek-reasoner',
      label: 'DeepSeek Reasoner',
      contextWindow: 128_000,
      maxOutputTokens: 64_000,
      tooltipMarkdown: 'High-reasoning model.',
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
      }),
    ).toEqual({ id: 'custom-model' });
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
      { id: 'deepseek-reasoner', contextWindow: 128_000, maxOutputTokens: 64_000 },
    ]);
  });

  it('clearing limit inputs removes the fields so provider defaults apply', () => {
    const reasoner = { id: 'deepseek-reasoner', contextWindow: 128_000, maxOutputTokens: 64_000 };

    const next = applyModelConfigurationDraft([reasoner], 'deepseek-reasoner', {
      ...createModelConfigurationDraft(reasoner),
      contextWindow: '',
      maxOutputTokens: '',
    });

    expect(next).toEqual([{ id: 'deepseek-reasoner' }]);
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
      }),
    ).toBeNull();
  });

  it('imports only new discovered models without inventing token limits', () => {
    const models = mergeDiscoveredModels(
      [{ id: 'deepseek-chat', contextWindow: 64_000 }],
      [
        { id: 'deepseek-chat', label: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
      ],
    );

    expect(models).toEqual([
      { id: 'deepseek-chat', contextWindow: 64_000 },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ]);
  });
});
