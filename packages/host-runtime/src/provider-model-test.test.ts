import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { testProviderModel } from './provider-model-test.js';

function createProvider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
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

    const result = await testProviderModel(createProvider(), 'coding-model', {
      resolveSecret: async () => 'test-secret',
      fetch: async (input, init) => {
        requestedUrl = String(input);
        requestedBody = String(init?.body);
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        return new Response(JSON.stringify({ choices: [] }), { status: 200 });
      },
    });

    expect(requestedUrl).toBe('https://api.example.com/v1/chat/completions');
    expect(authorization).toBe('Bearer test-secret');
    expect(JSON.parse(requestedBody)).toMatchObject({
      model: 'coding-model',
      max_tokens: 1,
      stream: false,
    });
    expect(result.modelId).toBe('coding-model');
  });

  it('probes with the model headers and custom request body (ADR 0095)', async () => {
    let requestedBody = '';
    let routeHeader = '';
    await testProviderModel(
      createProvider({
        baseUrl: 'https://openrouter.ai/api/v1',
        headers: { 'X-Title': 'piwin' },
        models: [
          {
            id: 'anthropic/claude-sonnet-4.5',
            headers: { 'X-Route': 'fast' },
            extraBody: { provider: { order: ['anthropic'], allow_fallbacks: false } },
          },
        ],
      }),
      'anthropic/claude-sonnet-4.5',
      {
        resolveSecret: async () => 'or-secret',
        fetch: async (_input, init) => {
          requestedBody = String(init?.body);
          routeHeader = new Headers(init?.headers).get('x-route') ?? '';
          return new Response(JSON.stringify({ choices: [] }), { status: 200 });
        },
      },
    );
    expect(routeHeader).toBe('fast');
    expect(JSON.parse(requestedBody)).toMatchObject({
      model: 'anthropic/claude-sonnet-4.5',
      max_tokens: 1,
      provider: { order: ['anthropic'], allow_fallbacks: false },
    });
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

  it('keeps non-v1 version segments verbatim like Pi (Volcengine Ark Agent Plan)', async () => {
    let requestedUrl = '';
    const result = await testProviderModel(
      createProvider({ baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3/' }),
      'glm-5.2',
      {
        resolveSecret: async () => 'ark-secret',
        fetch: async (input) => {
          requestedUrl = String(input);
          return new Response('{}', { status: 200 });
        },
      },
    );

    expect(requestedUrl).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/chat/completions');
    expect(result).toMatchObject({ chatApi: 'openai-completions', endpoint: requestedUrl });
  });

  it('does not insert /v1 for a versionless gateway root (Pi would not either)', async () => {
    let requestedUrl = '';
    await testProviderModel(createProvider({ baseUrl: 'http://127.0.0.1:8799' }), 'coding-model', {
      resolveSecret: async () => null,
      fetch: async (input) => {
        requestedUrl = String(input);
        return new Response('{}', { status: 200 });
      },
    });
    expect(requestedUrl).toBe('http://127.0.0.1:8799/chat/completions');
  });

  it('probes /responses with a Responses body when chatApi is openai-responses', async () => {
    let requestedUrl = '';
    let requestedBody = '';
    const result = await testProviderModel(
      createProvider({
        baseUrl: 'https://ark.cn-beijing.volces.com/api/plan/v3',
        chatApi: 'openai-responses',
      }),
      'doubao-seed-2.0-pro',
      {
        resolveSecret: async () => 'ark-secret',
        fetch: async (input, init) => {
          requestedUrl = String(input);
          requestedBody = String(init?.body);
          return new Response('{}', { status: 200 });
        },
      },
    );

    expect(requestedUrl).toBe('https://ark.cn-beijing.volces.com/api/plan/v3/responses');
    const body = JSON.parse(requestedBody) as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'doubao-seed-2.0-pro', input: 'ping', stream: false });
    expect(body.max_output_tokens).toBeGreaterThanOrEqual(16);
    expect(body).not.toHaveProperty('messages');
    expect(result.chatApi).toBe('openai-responses');
  });

  it('posts Anthropic probes to {baseUrl}/v1/messages like the Anthropic SDK', async () => {
    let requestedUrl = '';
    await testProviderModel(
      createProvider({
        protocol: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        models: [{ id: 'claude-x' }],
      }),
      'claude-x',
      {
        resolveSecret: async () => 'secret',
        fetch: async (input) => {
          requestedUrl = String(input);
          return new Response('{}', { status: 200 });
        },
      },
    );
    expect(requestedUrl).toBe('https://api.anthropic.com/v1/messages');
  });

  it('reports the HTTP status and provider message on rejection', async () => {
    await expect(
      testProviderModel(createProvider(), 'missing-model', {
        resolveSecret: async () => 'secret',
        fetch: async () =>
          new Response(JSON.stringify({ error: { message: 'model not found' } }), {
            status: 404,
            statusText: 'Not Found',
          }),
      }),
    ).rejects.toMatchObject({
      failureKind: 'http',
      httpStatus: 404,
      message: 'Model test failed (404 Not Found: model not found)',
    });
  });
});
