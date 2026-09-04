import { describe, expect, it } from 'vitest';
import { sessionComposerPromptFields } from './use-session-composer-profile.js';
import type { ModelOption } from '../model-options.js';

const MODELS: ModelOption[] = [
  {
    providerId: 'openai',
    modelId: 'gpt-4o',
    label: 'openai / GPT-4o',
    source: 'channel',
  },
  {
    providerId: 'anthropic',
    protocol: 'anthropic-compatible',
    modelId: 'claude-sonnet',
    label: 'anthropic / Claude Sonnet',
    source: 'channel',
    reasoning: true,
    thinkingLevels: ['low', 'medium', 'high'],
  },
];

describe('sessionComposerPromptFields', () => {
  it('omits model when the picker key is empty', () => {
    expect(
      sessionComposerPromptFields({
        modelOptions: MODELS,
        selectedModelKey: '',
        thinkingLevel: 'medium',
      }),
    ).toEqual({});
  });

  it('includes the selected model and skips thinking when the model has none', () => {
    expect(
      sessionComposerPromptFields({
        modelOptions: MODELS,
        selectedModelKey: 'openai::gpt-4o',
        thinkingLevel: 'medium',
      }),
    ).toEqual({
      model: { providerId: 'openai', modelId: 'gpt-4o', source: 'channel' },
    });
  });

  it('includes thinking when the selected model supports it', () => {
    expect(
      sessionComposerPromptFields({
        modelOptions: MODELS,
        selectedModelKey: 'anthropic::claude-sonnet',
        thinkingLevel: 'high',
      }),
    ).toEqual({
      model: {
        providerId: 'anthropic',
        modelId: 'claude-sonnet',
        protocol: 'anthropic-compatible',
        source: 'channel',
      },
      thinkingLevel: 'high',
    });
  });
});
