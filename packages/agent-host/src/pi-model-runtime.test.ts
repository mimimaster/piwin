import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  buildPiProviderRegistration,
  resolvePiApiForProvider,
} from './pi-model-runtime.js';

describe('pi-model-runtime', () => {
  it('maps product protocols to Pi provider APIs', () => {
    expect(resolvePiApiForProvider('openai-compatible')).toBe('openai-completions');
    expect(resolvePiApiForProvider('anthropic-compatible')).toBe('anthropic-messages');
    expect(resolvePiApiForProvider('google-gemini')).toBe('google-generative-ai');
  });

  it('builds a Pi provider registration with complete model descriptors', () => {
    const provider: ModelProviderConfig = {
      id: 'xai-local',
      protocol: 'openai-compatible',
      name: 'xAI local gateway',
      baseUrl: 'https://api.example.test/v1',
      apiKeyEnv: 'XAI_API_KEY',
      headers: { 'x-client': 'piwin' },
      models: [
        {
          id: 'grok-4.5',
          label: 'Grok 4.5',
          contextWindow: 128_000,
          maxOutputTokens: 8_192,
        },
      ],
    };

    const registration = buildPiProviderRegistration(provider, 'secret-value');
    expect(registration).toMatchObject({
      name: 'xAI local gateway',
      baseUrl: 'https://api.example.test/v1',
      api: 'openai-completions',
      apiKey: 'secret-value',
      authHeader: true,
      headers: { 'x-client': 'piwin' },
    });
    expect(registration.models).toEqual([
      expect.objectContaining({
        id: 'grok-4.5',
        name: 'Grok 4.5',
        api: 'openai-completions',
        baseUrl: 'https://api.example.test/v1',
        reasoning: true,
        input: ['text'],
        contextWindow: 128_000,
        maxTokens: 8_192,
      }),
    ]);
  });
});
