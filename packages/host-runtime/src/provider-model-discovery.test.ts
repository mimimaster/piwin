import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import { discoverProviderModels } from './provider-model-discovery.js';

function createProvider(overrides: Partial<ModelProviderConfig> = {}): ModelProviderConfig {
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
    expect(result.models).toEqual([expect.objectContaining({ id: 'claude-sonnet' })]);
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
    // Catalog enrich may attach input/reasoning/limits when the id is known.
    expect(result.models).toEqual([
      expect.objectContaining({ id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' }),
    ]);
  });

  it('includes the gateway error body in a 401 discovery failure', async () => {
    await expect(
      discoverProviderModels(createProvider({ baseUrl: 'http://127.0.0.1:8317/v1' }), {
        resolveSecret: async () => null,
        fetch: async () =>
          new Response(JSON.stringify({ error: 'Missing API key' }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: { 'content-type': 'application/json' },
          }),
      }),
    ).rejects.toThrow('Model discovery failed (401 Unauthorized: Missing API key)');
  });

  it('omits raw HTML markup when discovery returns an HTML error page', async () => {
    await expect(
      discoverProviderModels(createProvider({ baseUrl: 'https://openrouter.ai' }), {
        resolveSecret: async () => null,
        fetch: async () =>
          new Response('<!DOCTYPE html><html lang="en"><head><title>404 Not Found</title></head><body>404 Not Found</body></html>', {
            status: 404,
            statusText: 'Not Found',
            headers: { 'content-type': 'text/html' },
          }),
      }),
    ).rejects.toThrow('Model discovery failed (404 Not Found)');
  });

  it('allows an unauthenticated local OpenAI-compatible endpoint', async () => {
    let authorization: string | null = null;
    await discoverProviderModels(createProvider({ baseUrl: 'http://127.0.0.1:11434/v1' }), {
      resolveSecret: async () => null,
      fetch: async (_input, init) => {
        authorization = new Headers(init?.headers).get('authorization');
        return createJsonResponse({ data: [{ id: 'llama3.2' }] });
      },
    });

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

  it('auto-tags discovered models that match Pi image catalog entries', async () => {
    const result = await discoverProviderModels(createProvider(), {
      resolveSecret: async () => 'test-secret',
      fetch: async () =>
        createJsonResponse({
          data: [{ id: 'gpt-image-1' }, { id: 'deepseek-chat' }],
        }),
    });

    expect(result.models.map((model) => model.id).sort()).toEqual(['deepseek-chat', 'gpt-image-1']);
    const imageModel = result.models.find((model) => model.id === 'gpt-image-1');
    expect(imageModel?.capabilities).toContain('image-generation');
    const chatModel = result.models.find((model) => model.id === 'deepseek-chat');
    expect(chatModel?.capabilities).toBeUndefined();
  });

  it('auto-tags OpenAI-protocol realtime voice models', async () => {
    const result = await discoverProviderModels(createProvider(), {
      resolveSecret: async () => 'test-secret',
      fetch: async () =>
        createJsonResponse({
          data: [
            { id: 'grok-voice-think-fast-2.0' },
            { id: 'gpt-4o-realtime-preview' },
            { id: 'deepseek-chat' },
          ],
        }),
    });
    expect(
      result.models.find((model) => model.id === 'grok-voice-think-fast-2.0')?.capabilities,
    ).toContain('realtime-audio');
    expect(
      result.models.find((model) => model.id === 'gpt-4o-realtime-preview')?.capabilities,
    ).toContain('realtime-audio');
    expect(result.models.find((model) => model.id === 'deepseek-chat')?.capabilities).toBeUndefined();
  });

  it('auto-tags gateway image models that are not in the Pi catalog', async () => {
    const result = await discoverProviderModels(createProvider(), {
      resolveSecret: async () => 'test-secret',
      fetch: async () => createJsonResponse({ data: [{ id: 'grok-imagine-image-lite' }] }),
    });

    expect(result.models).toEqual([
      expect.objectContaining({
        id: 'grok-imagine-image-lite',
        capabilities: ['image-generation'],
      }),
    ]);
  });

  it('auto-tags Grok Imagine video from the curated registry', async () => {
    const result = await discoverProviderModels(
      createProvider({ protocol: 'anthropic-compatible' }),
      {
        resolveSecret: async () => 'test-secret',
        fetch: async () => createJsonResponse({ data: [{ id: 'grok-imagine-video' }] }),
      },
    );

    expect(result.models).toEqual([
      expect.objectContaining({
        id: 'grok-imagine-video',
        capabilities: ['video-generation'],
        videoGenerationSuggestion: {
          reason: 'registry',
          apiStyle: 'xgrok-videos',
          path: '/videos/generations',
          label: 'Grok Imagine Video',
        },
      }),
    ]);
  });

  it('auto-tags gemini image models by split-name match', async () => {
    const result = await discoverProviderModels(
      createProvider({
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      }),
      {
        resolveSecret: async () => 'gemini-secret',
        fetch: async () =>
          createJsonResponse({
            models: [{ name: 'models/gemini-3-pro-image', displayName: 'Gemini 3 Pro Image' }],
          }),
      },
    );

    const imageModel = result.models.find((model) => model.id === 'gemini-3-pro-image');
    expect(imageModel?.capabilities).toContain('image-generation');
  });

  it('suggests Sora with curated registry metadata', async () => {
    const result = await discoverProviderModels(createProvider(), {
      resolveSecret: async () => 'test-secret',
      fetch: async () => createJsonResponse({ data: [{ id: 'sora-2' }] }),
    });

    expect(result.models).toEqual([
      {
        id: 'sora-2',
        capabilities: ['video-generation'],
        videoGenerationSuggestion: {
          reason: 'registry',
          apiStyle: 'openai-videos',
          path: '/videos',
          label: 'Sora 2',
        },
        label: 'Sora 2',
      },
    ]);
  });

  it('suggests Veo with curated registry metadata', async () => {
    const result = await discoverProviderModels(
      createProvider({
        protocol: 'google-gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      }),
      {
        resolveSecret: async () => 'gemini-secret',
        fetch: async () =>
          createJsonResponse({
            models: [{ name: 'models/veo-3', displayName: 'Veo 3' }],
          }),
      },
    );

    expect(result.models).toEqual([
      {
        id: 'veo-3',
        label: 'Veo 3',
        capabilities: ['video-generation'],
        videoGenerationSuggestion: {
          reason: 'registry',
          apiStyle: 'google-veo',
          path: '/models/{model}:predictLongRunning',
          label: 'Google Veo',
        },
      },
    ]);
  });

  it('gives explicit provider metadata precedence over registry metadata', async () => {
    const result = await discoverProviderModels(createProvider(), {
      resolveSecret: async () => 'test-secret',
      fetch: async () =>
        createJsonResponse({
          data: [{ id: 'sora-2', capabilities: { video_generation: true } }],
        }),
    });

    expect(result.models).toEqual([
      {
        id: 'sora-2',
        capabilities: ['video-generation'],
        videoGenerationSuggestion: { reason: 'provider' },
      },
    ]);
  });

  it('suggests Kling and Pika heuristically without auto-tagging', async () => {
    const result = await discoverProviderModels(createProvider(), {
      resolveSecret: async () => 'test-secret',
      fetch: async () => createJsonResponse({ data: [{ id: 'kling-v1' }, { id: 'pika-1.0' }] }),
    });

    expect(result.models).toEqual([
      {
        id: 'kling-v1',
        videoGenerationSuggestion: { reason: 'heuristic' },
      },
      {
        id: 'pika-1.0',
        videoGenerationSuggestion: { reason: 'heuristic' },
      },
    ]);
    expect(result.models.every((model) => !model.capabilities?.includes('video-generation'))).toBe(
      true,
    );
  });

  it('does not suggest video generation for video-understanding models', async () => {
    const result = await discoverProviderModels(createProvider(), {
      resolveSecret: async () => 'test-secret',
      fetch: async () =>
        createJsonResponse({
          data: [
            { id: 'video-understanding-model' },
            { id: 'vision-video-chat' },
            { id: 'video-model', input_modalities: ['video'] },
          ],
        }),
    });

    expect(result.models).toEqual([
      { id: 'video-model' },
      { id: 'video-understanding-model' },
      { id: 'vision-video-chat' },
    ]);
  });

  it('exposes Sora discovery metadata in the shape the video runtime consumes', async () => {
    const result = await discoverProviderModels(createProvider(), {
      resolveSecret: async () => 'test-secret',
      fetch: async () => createJsonResponse({ data: [{ id: 'sora-2' }] }),
    });

    const sora = result.models.find((model) => model.id === 'sora-2');
    expect(sora).toMatchObject({
      id: 'sora-2',
      capabilities: ['video-generation'],
      videoGenerationSuggestion: {
        reason: 'registry',
        apiStyle: 'openai-videos',
        path: '/videos',
        label: 'Sora 2',
      },
      label: 'Sora 2',
    });
    // The runtime bridge (resolveVideoProvider/buildVideoGenTool) is verified
    // in video-gen-tool.test.ts to avoid a host-runtime self-import here.
  });
});
