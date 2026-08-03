import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_MAX_OUTPUT_TOKENS } from '@piwin/contracts';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  buildPiProviderRegistration,
  ensureModelAcceptsImages,
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
          thinkingLevels: ['low', 'medium', 'high'],
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
    expect(registration.models[0]).not.toHaveProperty('thinkingLevels');
  });

  it('defaults omitted maxOutputTokens to the shared product default', () => {
    const provider: ModelProviderConfig = {
      id: 'plain',
      protocol: 'openai-compatible',
      name: 'Plain',
      baseUrl: 'https://api.example.test/v1',
      models: [{ id: 'text-only-model' }],
    };
    const registration = buildPiProviderRegistration(provider);
    expect(registration.models[0]?.maxTokens).toBe(DEFAULT_MODEL_MAX_OUTPUT_TOKENS);
  });

  it('passes through model input and reasoning from config', () => {
    const provider: ModelProviderConfig = {
      id: 'vision-proxy',
      protocol: 'anthropic-compatible',
      name: 'Vision proxy',
      baseUrl: 'https://api.example.test',
      models: [
        {
          id: 'claude-vision',
          input: ['text', 'image'],
          reasoning: false,
        },
      ],
    };
    const registration = buildPiProviderRegistration(provider);
    expect(registration.models[0]).toMatchObject({
      id: 'claude-vision',
      input: ['text', 'image'],
      reasoning: false,
    });
  });

  it('defaults omitted input to text-only and reasoning to true', () => {
    const provider: ModelProviderConfig = {
      id: 'plain',
      protocol: 'openai-compatible',
      name: 'Plain',
      baseUrl: 'https://api.example.test/v1',
      models: [{ id: 'text-only-model' }],
    };
    const registration = buildPiProviderRegistration(provider);
    expect(registration.models[0]?.input).toEqual(['text']);
    expect(registration.models[0]?.reasoning).toBe(true);
  });

  it('ensureModelAcceptsImages forces vision when missing', () => {
    const textOnly = { id: 'swe-1-7', input: ['text'] as Array<'text' | 'image'> };
    expect(ensureModelAcceptsImages(textOnly).input).toEqual(['text', 'image']);
    const alreadyVision = { id: 'v', input: ['text', 'image'] as Array<'text' | 'image'> };
    expect(ensureModelAcceptsImages(alreadyVision)).toBe(alreadyVision);
  });
});
