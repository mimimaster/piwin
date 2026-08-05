import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { testProviderModel } from './provider-model-test.js';

function createProvider(
  overrides: Partial<ModelProviderConfig> = {},
): ModelProviderConfig {
  return {
    id: 'custom-provider',
    name: 'Custom provider',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    models: [{ id: 'coding-model' }],
    ...overrides,
  };
}

describe('testProviderModel', () => {
  it('tests one OpenAI-compatible model with a minimal generation request', async () => {
    let requestedUrl = '';
    let requestedBody = '';
    let authorization = '';

    const result = await testProviderModel(
      createProvider(),
      'coding-model',
      {
        resolveSecret: async () => 'test-secret',
        fetch: async (input, init) => {
          requestedUrl = String(input);
          requestedBody = String(init?.body);
          authorization = new Headers(init?.headers).get('authorization') ?? '';
          return new Response(JSON.stringify({ choices: [] }), { status: 200 });
        },
      },
    );

    expect(requestedUrl).toBe('https://api.example.com/v1/chat/completions');
    expect(authorization).toBe('Bearer test-secret');
    expect(JSON.parse(requestedBody)).toMatchObject({
      model: 'coding-model',
      max_tokens: 1,
      stream: false,
    });
    expect(result.modelId).toBe('coding-model');
  });

  it('uses the configured Gemini model resource for a real generation probe', async () => {
    let requestedUrl = '';
    let requestedBody = '';

    await testProviderModel(
      createProvider({
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        models: [{ id: 'gemini-2.5-pro' }],
      }),
      'gemini-2.5-pro',
      {
        resolveSecret: async () => 'gemini-secret',
        fetch: async (input, init) => {
          requestedUrl = String(input);
          requestedBody = String(init?.body);
          return new Response(JSON.stringify({ candidates: [] }), { status: 200 });
        },
      },
    );

    expect(requestedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
    );
    expect(JSON.parse(requestedBody)).toMatchObject({
      generationConfig: { maxOutputTokens: 1 },
    });
  });
});
