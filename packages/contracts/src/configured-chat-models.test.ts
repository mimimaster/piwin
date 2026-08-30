import { describe, expect, it } from 'vitest';
import { projectConfiguredChatModels } from './configured-chat-models.js';
import type { PiwinConfig } from './config.js';

function config(
  overrides: Partial<Pick<PiwinConfig, 'providers' | 'defaultProviderId' | 'defaultModelId'>> = {},
): Pick<PiwinConfig, 'providers' | 'defaultProviderId' | 'defaultModelId'> {
  return {
    providers: [
      {
        id: 'custom-anthropic',
        name: 'Custom Anthropic',
        protocol: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKeyEnv: 'SECRET_ENV',
        models: [
          {
            id: 'deepseek-v4-flash',
            label: 'DeepSeek V4 Flash',
            thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
            thinkingLevel: 'max',
          },
          { id: 'whisper-1', capabilities: ['speech-to-text'] },
        ],
      },
      {
        id: 'disabled-provider',
        name: 'Disabled',
        protocol: 'openai-compatible',
        baseUrl: 'http://example.invalid',
        enabled: false,
        models: [{ id: 'hidden-chat' }],
      },
    ],
    defaultProviderId: 'custom-anthropic',
    defaultModelId: 'deepseek-v4-flash',
    ...overrides,
  };
}

describe('projectConfiguredChatModels', () => {
  it('returns enabled chat models without secrets or endpoints', () => {
    const projected = projectConfiguredChatModels(config());
    expect(projected).toEqual({
      defaultProviderId: 'custom-anthropic',
      defaultModelId: 'deepseek-v4-flash',
      models: [
        {
          providerId: 'custom-anthropic',
          protocol: 'openai-compatible',
          modelId: 'deepseek-v4-flash',
          label: 'DeepSeek V4 Flash',
          thinkingLevel: 'max',
          thinkingLevels: ['off', 'low', 'medium', 'high', 'max'],
          source: 'channel',
          group: 'channel',
        },
      ],
    });
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('8317');
    expect(serialized).not.toContain('SECRET_ENV');
    expect(serialized).not.toContain('hidden-chat');
    expect(serialized).not.toContain('whisper-1');
  });

  it('projects a seeded OAuth provider as subscription rows without a BYOK protocol', () => {
    const projected = projectConfiguredChatModels(
      config({
        providers: [
          {
            id: 'openai-codex',
            name: 'ChatGPT Codex',
            protocol: 'openai-compatible',
            baseUrl: 'oauth://openai-codex',
            source: 'subscription',
            models: [{ id: 'gpt-5.4-codex', label: 'GPT-5.4 Codex' }],
          },
        ],
      }),
    );
    expect(projected.models).toEqual([
      {
        providerId: 'openai-codex',
        modelId: 'gpt-5.4-codex',
        label: 'GPT-5.4 Codex',
        source: 'subscription',
        group: 'subscription',
      },
    ]);
  });
});
