import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { discoverProviderModels } from './provider-model-discovery.js';

function createProvider(
  overrides: Partial<ModelProviderConfig> = {},
): ModelProviderConfig {
  return {
    id: 'custom-provider',
    name: 'Custom provider',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.example.com/v1',
    models: [],
    ...overrides,
  };
}

function createJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('discoverProviderModels', () => {
  it('discovers OpenAI-compatible models from a custom base URL', async () => {
    let requestedUrl = '';
    let authorization = '';
    const result = await discoverProviderModels(createProvider({ apiKeyEnv: 'CUSTOM_KEY' }), {
      resolveSecret: async () => 'test-secret',
      fetch: async (input, init) => {
        requestedUrl = String(input);
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        return createJsonResponse({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] });
      },
    });

    expect(requestedUrl).toBe('https://api.example.com/v1/models');
    expect(authorization).toBe('Bearer test-secret');
    expect(result.models).toEqual([{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }]);
  });

  it('uses Anthropic headers and normalizes the models list', async () => {
    let apiVersion = '';
    const result = await discoverProviderModels(
      createProvider({
        protocol: 'anthropic-compatible',
        baseUrl: 'https://api.example.com',
        apiKeyRef: 'keychain:anthropic',
      }),
      {
        resolveSecret: async () => 'anthropic-secret',
        fetch: async (_input, init) => {
          apiVersion = new Headers(init?.headers).get('anthropic-version') ?? '';
          return createJsonResponse({ data: [{ id: 'claude-sonnet' }] });
        },
      },
    );

    expect(apiVersion).toBe('2023-06-01');
    expect(result.models).toEqual([{ id: 'claude-sonnet' }]);
  });

  it('normalizes Google Gemini model resource names', async () => {
    let apiKey = '';
    const result = await discoverProviderModels(
      createProvider({
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKeyEnv: 'GEMINI_KEY',
      }),
      {
        resolveSecret: async () => 'gemini-secret',
        fetch: async (_input, init) => {
          apiKey = new Headers(init?.headers).get('x-goog-api-key') ?? '';
          return createJsonResponse({
            models: [{ name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' }],
          });
        },
      },
    );

    expect(apiKey).toBe('gemini-secret');
    expect(result.models).toEqual([{ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }]);
  });

  it('allows an unauthenticated local OpenAI-compatible endpoint', async () => {
    let authorization: string | null = null;
    await discoverProviderModels(
      createProvider({ baseUrl: 'http://127.0.0.1:11434/v1' }),
      {
        resolveSecret: async () => null,
        fetch: async (_input, init) => {
          authorization = new Headers(init?.headers).get('authorization');
          return createJsonResponse({ data: [{ id: 'llama3.2' }] });
        },
      },
    );

    expect(authorization).toBeNull();
  });

  it('sends user-configured custom headers on discovery', async () => {
    let httpReferer = '';
    let title = '';
    await discoverProviderModels(
      createProvider({
        headers: {
          'HTTP-Referer': 'https://piwin.app',
          'X-Title': 'piwin',
        },
      }),
      {
        resolveSecret: async () => null,
        fetch: async (_input, init) => {
          const headerBag = new Headers(init?.headers);
          httpReferer = headerBag.get('http-referer') ?? '';
          title = headerBag.get('x-title') ?? '';
          return createJsonResponse({ data: [{ id: 'm1' }] });
        },
      },
    );

    expect(httpReferer).toBe('https://piwin.app');
    expect(title).toBe('piwin');
  });

  it('does not let custom headers replace protocol authentication', async () => {
    let authorization = '';
    await discoverProviderModels(
      createProvider({
        headers: {
          Authorization: 'Bearer user-configured-value',
          'HTTP-Referer': 'https://piwin.app',
        },
      }),
      {
        resolveSecret: async () => 'resolved-secret',
        fetch: async (_input, init) => {
          authorization = new Headers(init?.headers).get('authorization') ?? '';
          return createJsonResponse({ data: [{ id: 'm1' }] });
        },
      },
    );

    expect(authorization).toBe('Bearer resolved-secret');
  });
});
