import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  GoogleGeminiProviderConfig,
  ModelConfigEntry,
  ModelProviderConfig,
  OpenAiCompatibleProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import {
  resolveImageProvider,
  callImageEndpoint,
  buildImageGenTool,
  ImageGenConfigError,
} from './image-gen-tool.js';

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const WEBP_BYTES = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function imageModel(provider: ModelProviderConfig, index = 0): ModelConfigEntry {
  const model = provider.models[index];
  if (!model) throw new Error(`expected model at index ${index}`);
  return model;
}

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

const openAiProvider: OpenAiCompatibleProviderConfig = {
  id: 'openai',
  protocol: 'openai-compatible',
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  models: [{ id: 'gpt-image-1', label: 'gpt-image-1', capabilities: ['image-generation'] }],
};

const geminiProvider: GoogleGeminiProviderConfig = {
  id: 'gemini',
  protocol: 'google-gemini',
  name: 'Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKeyEnv: 'GEMINI_API_KEY',
  models: [
    {
      id: 'imagen-4.0-generate-001',
      label: 'imagen-4.0',
      capabilities: ['image-generation'],
    },
  ],
};

const baseConfig = {
  hostMode: 'sdk' as const,
  providers: [openAiProvider, geminiProvider],
  defaultProviderId: 'openai',
  defaultModelId: 'gpt-4o',
  media: {
    maxPasteBytes: 10 * 1024 * 1024,
    allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  },
  artifact: {
    enabled: true,
    triggerMode: 'automatic' as const,
    decisionPrompt: { mode: 'default' as const, customPrompt: '' },
    maxBytes: 100_000,
  },
};

function configWith(overrides: Partial<PiwinConfig>): PiwinConfig {
  return { ...baseConfig, ...overrides };
}

describe('resolveImageProvider', () => {
  it('resolves an explicit image model across providers', () => {
    const resolved = resolveImageProvider(configWith({}), 'imagen-4.0-generate-001');
    expect(resolved.provider.id).toBe('gemini');
    expect(resolved.model.id).toBe('imagen-4.0-generate-001');
  });

  it('prefers config.imageGeneration.defaultModel independently from chat', () => {
    const resolved = resolveImageProvider(
      configWith({
        imageGeneration: {
          defaultModel: {
            protocol: 'google-gemini',
            providerId: 'gemini',
            modelId: 'imagen-4.0-generate-001',
          },
        },
      }),
    );
    expect(resolved.provider.id).toBe('gemini');
  });

  it('uses the only enabled image model when no image default exists', () => {
    const resolved = resolveImageProvider(
      configWith({ providers: [{ ...openAiProvider }, { ...geminiProvider, enabled: false }] }),
    );
    expect(resolved.model.id).toBe('gpt-image-1');
  });

  it('uses the first enabled image model when no image default exists', () => {
    const resolved = resolveImageProvider(configWith({}));
    expect(resolved.provider.id).toBe('openai');
    expect(resolved.model.id).toBe('gpt-image-1');
  });

  it('does not choose a chat default when multiple image models exist', () => {
    const provider: OpenAiCompatibleProviderConfig = {
      ...openAiProvider,
      models: [{ id: 'gpt-4o', capabilities: ['chat'] }, ...openAiProvider.models],
    };
    const resolved = resolveImageProvider(
      configWith({
        providers: [provider, geminiProvider],
        defaultProviderId: 'openai',
        defaultModelId: 'gpt-4o',
      }),
    );
    expect(resolved.provider.id).toBe('openai');
    expect(resolved.model.id).toBe('gpt-image-1');
  });

  it('rejects a stale image default instead of silently changing models', () => {
    expect(() =>
      resolveImageProvider(
        configWith({
          imageGeneration: {
            defaultModel: {
              protocol: 'openai-compatible',
              providerId: 'openai',
              modelId: 'removed-image-model',
            },
          },
        }),
      ),
    ).toThrow(/default image model/i);
  });

  it('rejects a non-image explicit model', () => {
    const provider: OpenAiCompatibleProviderConfig = {
      ...openAiProvider,
      models: [...openAiProvider.models, { id: 'gpt-4o', capabilities: ['chat'] }],
    };
    expect(() => resolveImageProvider(configWith({ providers: [provider] }), 'gpt-4o')).toThrow(
      /image-generation capability/i,
    );
  });

  it('requires provider id when image model ids overlap', () => {
    const duplicate = { ...geminiProvider, models: [{ ...imageModel(openAiProvider) }] };
    const config = configWith({ providers: [openAiProvider, duplicate] });
    expect(() => resolveImageProvider(config, 'gpt-image-1')).toThrow(/multiple providers/i);
    expect(resolveImageProvider(config, 'gpt-image-1', 'gemini').provider.id).toBe('gemini');
  });
});

describe('callImageEndpoint', () => {
  it('routes OpenAI-compatible requests, sends custom headers, and detects PNG', async () => {
    const provider = { ...openAiProvider, headers: { 'X-Title': 'piwin' } };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: [{ b64_json: base64(PNG_BYTES), revised_prompt: 'refined' }] }),
      );
    const images = await callImageEndpoint(
      provider,
      imageModel(provider),
      { prompt: 'a cat' },
      'sk-test',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer sk-test',
          'X-Title': 'piwin',
        }),
      }),
    );
    expect(images).toEqual([
      expect.objectContaining({ mimeType: 'image/png', revisedPrompt: 'refined' }),
    ]);
  });

  it('normalizes every returned OpenAI image instead of truncating the batch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { b64_json: base64(PNG_BYTES) },
          { b64_json: base64(JPEG_BYTES) },
          { b64_json: base64(WEBP_BYTES) },
          { b64_json: base64(GIF_BYTES) },
        ],
      }),
    );
    const images = await callImageEndpoint(
      openAiProvider,
      imageModel(openAiProvider),
      { prompt: 'four variants', n: 4 },
      'key',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(images.map((image) => image.mimeType)).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
    ]);
  });

  it('downloads URL outputs and trusts JPEG magic bytes over response metadata', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: [{ url: 'https://cdn.example/image' }] }))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' }),
        arrayBuffer: async () => JPEG_BYTES.slice().buffer,
      } as Response);
    const images = await callImageEndpoint(
      openAiProvider,
      imageModel(openAiProvider),
      { prompt: 'a cat' },
      'key',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(images[0]?.mimeType).toBe('image/jpeg');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('routes Gemini Imagen to :predict and normalizes all predictions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        predictions: [
          { bytesBase64Encoded: base64(PNG_BYTES) },
          { bytesBase64Encoded: base64(JPEG_BYTES) },
        ],
      }),
    );
    const images = await callImageEndpoint(
      geminiProvider,
      imageModel(geminiProvider),
      { prompt: 'a dog', n: 2 },
      'sk-gem',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'models/imagen-4.0-generate-001:predict',
    );
    expect(images.map((image) => image.mimeType)).toEqual(['image/png', 'image/jpeg']);
  });

  it('routes to a normalized custom relative path', async () => {
    const provider = {
      ...openAiProvider,
      models: [
        {
          ...imageModel(openAiProvider),
          routes: { 'image-generation': { path: 'images/custom' } },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ b64_json: base64(PNG_BYTES) }] }));
    await callImageEndpoint(
      provider,
      imageModel(provider),
      { prompt: 'a cat' },
      'key',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/custom',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects absolute route paths, invalid counts, and non-image payloads', async () => {
    const provider = {
      ...openAiProvider,
      models: [
        {
          ...imageModel(openAiProvider),
          routes: { 'image-generation': { path: 'https://other.example/v1/images' } },
        },
      ],
    };
    const fetchMock = vi.fn();
    await expect(
      callImageEndpoint(
        provider,
        imageModel(provider),
        { prompt: 'x' },
        'key',
        undefined,
        fetchMock,
      ),
    ).rejects.toBeInstanceOf(ImageGenConfigError);
    await expect(
      callImageEndpoint(openAiProvider, imageModel(openAiProvider), { prompt: 'x', n: 5 }, 'key'),
    ).rejects.toThrow(/between 1 and 4/i);

    const invalidFetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }),
      );
    await expect(
      callImageEndpoint(
        openAiProvider,
        imageModel(openAiProvider),
        { prompt: 'x' },
        'key',
        undefined,
        invalidFetch as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/invalid image bytes/i);
  });

  it('includes a bounded provider error message and redacts credential-like values', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: { message: 'bad request sk-abcdefghijklmnop' } }),
    } as Response);
    await expect(
      callImageEndpoint(
        openAiProvider,
        imageModel(openAiProvider),
        { prompt: 'x' },
        'key',
        undefined,
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/bad request \[redacted\]/i);
  });

  it('infers Gemini native from the model id on an OpenAI-compatible channel', async () => {
    const provider: OpenAiCompatibleProviderConfig = {
      ...openAiProvider,
      models: [{ id: 'gemini-3.1-flash-image', capabilities: ['image-generation'] }],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: 'image/png', data: base64(PNG_BYTES) } }] } },
        ],
      }),
    );
    await callImageEndpoint(
      provider,
      imageModel(provider),
      { prompt: 'a cat' },
      'key',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/models/gemini-3.1-flash-image:generateContent',
    );
  });

  it('speaks Gemini native :generateContent when apiStyle is gemini', async () => {
    const provider: GoogleGeminiProviderConfig = {
      ...geminiProvider,
      models: [
        {
          id: 'gemini-3.1-flash-image',
          capabilities: ['image-generation'],
          routes: { 'image-generation': { apiStyle: 'gemini' } },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { text: 'here is the image' },
                { inlineData: { mimeType: 'image/jpeg', data: base64(JPEG_BYTES) } },
              ],
            },
          },
          {
            content: {
              parts: [{ inlineData: { data: `data:image/png;base64,${base64(PNG_BYTES)}` } }],
            },
          },
        ],
      }),
    );
    const images = await callImageEndpoint(
      provider,
      imageModel(provider),
      { prompt: 'a red apple', n: 2 },
      'gem-key',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('models/gemini-3.1-flash-image:generateContent');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'a red apple' }] }]);
    expect(body.generationConfig).toEqual({
      responseModalities: ['TEXT', 'IMAGE'],
      candidateCount: 2,
    });
    expect(init.headers).toEqual(expect.objectContaining({ 'x-goog-api-key': 'gem-key' }));
    // Text-only parts are skipped; inlineData parts (raw base64 + data URL) are kept.
    expect(images.map((image) => image.mimeType)).toEqual(['image/jpeg', 'image/png']);
  });

  it('supports apiStyle gemini on an openai-compatible proxy channel', async () => {
    // e.g. cliproxy: openai-compatible channel + Gemini-native image model.
    const provider: OpenAiCompatibleProviderConfig = {
      ...openAiProvider,
      baseUrl: 'http://127.0.0.1:8317',
      models: [
        {
          id: 'gemini-3.1-flash-image',
          capabilities: ['image-generation'],
          routes: {
            'image-generation': {
              apiStyle: 'gemini',
              path: '/v1beta/models/gemini-3.1-flash-image:generateContent',
            },
          },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        candidates: [{ content: { parts: [{ inlineData: { data: base64(WEBP_BYTES) } }] } }],
      }),
    );
    const images = await callImageEndpoint(
      provider,
      imageModel(provider),
      { prompt: 'a cat' },
      'proxy-key',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8317/v1beta/models/gemini-3.1-flash-image:generateContent');
    expect(init.headers).toEqual(expect.objectContaining({ authorization: 'Bearer proxy-key' }));
    expect(JSON.parse(String(init.body))).toMatchObject({
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    });
    expect(images[0]?.mimeType).toBe('image/webp');
  });

  it('supports explicit imagen apiStyle on a google-gemini channel', async () => {
    const provider: GoogleGeminiProviderConfig = {
      ...geminiProvider,
      models: [
        {
          id: 'imagen-4.0-generate-001',
          capabilities: ['image-generation'],
          routes: { 'image-generation': { apiStyle: 'imagen' } },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ predictions: [{ bytesBase64Encoded: base64(PNG_BYTES) }] }),
      );
    const images = await callImageEndpoint(
      provider,
      imageModel(provider),
      { prompt: 'a dog' },
      'gem-key',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(':predict');
    expect(images[0]?.mimeType).toBe('image/png');
  });

  it('rejects a video-only apiStyle on an image route', async () => {
    const provider: OpenAiCompatibleProviderConfig = {
      ...openAiProvider,
      models: [
        {
          ...imageModel(openAiProvider),
          routes: { 'image-generation': { apiStyle: 'runway-tasks' as never } },
        },
      ],
    };
    await expect(
      callImageEndpoint(provider, imageModel(provider), { prompt: 'x' }, 'key'),
    ).rejects.toThrow(/apiStyle "runway-tasks" is not valid for image generation/i);
  });

  it('rejects a Gemini native response without any image parts', async () => {
    const provider: GoogleGeminiProviderConfig = {
      ...geminiProvider,
      models: [
        {
          id: 'gemini-3.1-flash-image',
          capabilities: ['image-generation'],
          routes: { 'image-generation': { apiStyle: 'gemini' } },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] }),
      );
    await expect(
      callImageEndpoint(
        provider,
        imageModel(provider),
        { prompt: 'x' },
        'key',
        undefined,
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/provider returned no image data/i);
  });

  it('posts Codex OAuth images to the Codex backend instead of oauth://', async () => {
    const provider: OpenAiCompatibleProviderConfig = {
      id: 'openai-codex',
      protocol: 'openai-compatible',
      name: 'ChatGPT Codex',
      baseUrl: 'oauth://openai-codex',
      source: 'subscription',
      models: [
        {
          id: 'gpt-image-2',
          capabilities: ['image-generation'],
          routes: {
            'image-generation': { path: '/codex/images/generations', apiStyle: 'openai' },
          },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ b64_json: base64(PNG_BYTES) }] }));
    await callImageEndpoint(
      provider,
      imageModel(provider),
      { prompt: 'a lantern' },
      '',
      undefined,
      fetchMock as unknown as typeof fetch,
      { accessToken: 'codex-token', accountId: 'acct-1' },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer codex-token',
          'OpenAI-Beta': 'codex-1',
          'ChatGPT-Account-Id': 'acct-1',
        }),
      }),
    );
  });

  it('posts Grok Imagine images to api.x.ai with the CLI token header', async () => {
    const provider: OpenAiCompatibleProviderConfig = {
      id: 'xai',
      protocol: 'openai-compatible',
      name: 'Grok',
      baseUrl: 'oauth://xai',
      source: 'subscription',
      models: [
        {
          id: 'grok-imagine-image-2.0',
          capabilities: ['image-generation'],
          routes: { 'image-generation': { path: '/images/generations', apiStyle: 'openai' } },
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: [{ b64_json: base64(PNG_BYTES) }] }));
    await callImageEndpoint(
      provider,
      imageModel(provider),
      { prompt: 'a collie' },
      '',
      undefined,
      fetchMock as unknown as typeof fetch,
      { accessToken: 'grok-token' },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.x.ai/v1/images/generations',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer grok-token',
          'X-XAI-Token-Auth': 'xai-grok-cli',
        }),
      }),
    );
  });

  it('rejects anthropic-compatible with a clear unsupported error', async () => {
    const anthropic: ModelProviderConfig = {
      id: 'anthropic',
      protocol: 'anthropic-compatible',
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: [{ id: 'claude-image-1', capabilities: ['image-generation'] }],
    };
    await expect(
      callImageEndpoint(anthropic, imageModel(anthropic), { prompt: 'x' }, 'key'),
    ).rejects.toThrow(/not support/i);
  });
});

describe('buildImageGenTool', () => {
  it('registers image_gen when multiple image models exist without a default', () => {
    const tool = buildImageGenTool({
      piwinRoot: '/tmp/piwin',
      sessionId: 's1',
      config: configWith({}),
      mediaConfig: {
        mediaRoot: '/tmp/piwin/media',
        maxPasteBytes: 10_000_000,
        allowedMimeTypes: ['image/png'],
      },
      secretResolver: { resolveProviderSecret: async () => 'k' } as never,
    });
    expect(tool).not.toBeNull();
  });

  it('returns null when no enabled image model can be resolved', () => {
    const tool = buildImageGenTool({
      piwinRoot: '/tmp/piwin',
      sessionId: 's1',
      config: configWith({ providers: [] }),
      mediaConfig: {
        mediaRoot: '/tmp/piwin/media',
        maxPasteBytes: 10_000_000,
        allowedMimeTypes: ['image/png'],
      },
      secretResolver: { resolveProviderSecret: async () => 'k' } as never,
    });
    expect(tool).toBeNull();
  });

  it('saves every returned image with the detected MIME type and extension', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-image-gen-'));
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [{ b64_json: base64(PNG_BYTES) }, { b64_json: base64(JPEG_BYTES) }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const tool = buildImageGenTool({
        piwinRoot: '/tmp/piwin',
        sessionId: 'session-1',
        config: configWith({
          providers: [openAiProvider],
          imageGeneration: {
            defaultModel: {
              protocol: 'openai-compatible',
              providerId: 'openai',
              modelId: 'gpt-image-1',
            },
          },
        }),
        mediaConfig: {
          mediaRoot,
          maxPasteBytes: 10_000_000,
          allowedMimeTypes: ['image/png', 'image/jpeg'],
        },
        secretResolver: { resolveProviderSecret: async () => 'key' } as never,
      });
      if (!tool) throw new Error('image_gen tool should be available');

      const result = await tool.execute(
        { prompt: 'two cats', n: 2 },
        new AbortController().signal,
        {
          sessionId: 'session-1',
          runtimeGenerationId: 'generation-1',
          runId: 'run-1',
          toolName: 'image_gen',
        },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.message);

      const attachments = result.details?.attachments;
      expect(Array.isArray(attachments) ? attachments : []).toEqual([
        expect.objectContaining({ mimeType: 'image/png', source: 'generated' }),
        expect.objectContaining({ mimeType: 'image/jpeg', source: 'generated' }),
      ]);
      const paths = Array.isArray(result.details?.paths)
        ? result.details.paths.filter((value): value is string => typeof value === 'string')
        : [];
      expect(paths.map((path) => extname(path))).toEqual(['.png', '.jpg']);
      expect(new Uint8Array(await readFile(paths[1] ?? ''))).toEqual(JPEG_BYTES);

      const parsed = JSON.parse(result.output) as {
        status?: string;
        imageCount?: number;
        mediaIds?: unknown;
        paths?: unknown;
        notice?: string;
      };
      expect(parsed.status).toBe('success');
      expect(parsed.imageCount).toBe(2);
      expect(Array.isArray(parsed.mediaIds) ? parsed.mediaIds : []).toHaveLength(2);
      expect(parsed.paths).toBeUndefined();
      expect(result.output).not.toContain(mediaRoot);
      expect(parsed.notice).toMatch(/already rendered/i);
      expect(parsed.notice).toContain('data-piwin-media');
      expect(parsed.notice).toMatch(/data:image/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
