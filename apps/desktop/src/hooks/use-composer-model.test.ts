import { describe, expect, it } from 'vitest';
import { describeComposerModel } from './use-composer-model.js';
import type { ModelOption } from '../model-options';

const gpt: ModelOption = {
  providerId: 'openai',
  protocol: 'openai-compatible',
  modelId: 'gpt',
  label: 'GPT',
  contextWindow: 128_000,
};

const sonnet: ModelOption = {
  providerId: 'anthropic',
  protocol: 'anthropic-compatible',
  modelId: 'sonnet',
  label: 'Sonnet',
  contextWindow: 200_000,
};

describe('describeComposerModel', () => {
  it('uses the selected model label and context window', () => {
    const described = describeComposerModel([gpt, sonnet], 'anthropic::sonnet', {
      providerId: 'openai',
      modelId: 'gpt',
    });
    expect(described.label).toBe('Sonnet');
    expect(described.contextWindow).toBe(200_000);
    expect(described.promptModel).toEqual({
      protocol: 'anthropic-compatible',
      providerId: 'anthropic',
      modelId: 'sonnet',
    });
  });

  it('falls back to the product default when nothing is selected', () => {
    const described = describeComposerModel([gpt, sonnet], '', {
      providerId: 'openai',
      modelId: 'gpt',
    });
    expect(described.label).toBe('Default model');
    expect(described.contextWindow).toBe(128_000);
    expect(described.promptModel?.modelId).toBe('gpt');
  });
});
