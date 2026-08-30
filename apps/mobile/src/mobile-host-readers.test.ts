import { describe, expect, it } from 'vitest';
import { readConfiguredChatModels } from './mobile-host-readers.js';

describe('mobile configured chat models', () => {
  it('keeps subscription rows that have no BYOK protocol', () => {
    const data = readConfiguredChatModels({
      type: 'response',
      command: 'models/configured',
      success: true,
      data: {
        models: [
          {
            providerId: 'openai-codex',
            modelId: 'gpt-5.4-codex',
            source: 'subscription',
            group: 'subscription',
          },
          {
            providerId: 'custom-openai',
            modelId: 'grok-4.6',
            protocol: 'openai-compatible',
            source: 'channel',
          },
          {
            providerId: 'broken',
            modelId: 'x',
          },
        ],
        defaultProviderId: 'openai-codex',
        defaultModelId: 'gpt-5.4-codex',
      },
    });
    expect(data.models).toEqual([
      {
        providerId: 'openai-codex',
        modelId: 'gpt-5.4-codex',
        source: 'subscription',
        group: 'subscription',
      },
      {
        providerId: 'custom-openai',
        modelId: 'grok-4.6',
        protocol: 'openai-compatible',
        source: 'channel',
        group: 'channel',
      },
    ]);
    expect(data.defaultProviderId).toBe('openai-codex');
  });
});
