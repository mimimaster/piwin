import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type {
  GoogleGeminiProviderConfig,
  OpenAiCompatibleProviderConfig,
  PiwinConfig,
} from '@piwin/contracts';
import {
  resolveImageProvider,
  callImageEndpoint,
  buildImageGenTool,
  ImageGenConfigError,
} from './image-gen-tool.js';

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
  defaultModelId: 'gpt-image-1',
  media: { maxPasteBytes: 10 * 1024 * 1024, allowedMimeTypes: ['image/png', 'image/jpeg'] },
  artifact: {
    enabled: true,
    triggerMode: 'automatic',
    decisionPrompt: { mode: 'default', customPrompt: '' },
    maxBytes: 100_000,
  },
};

function configWith(overrides: Partial<PiwinConfig>): PiwinConfig {
  return { ...baseConfig, ...overrides } as PiwinConfig;
}

describe('resolveImageProvider', () => {
  it('resolves by explicit model name across providers', () => {
    const { provider, model } = resolveImageProvider(configWith({}), 'imagen-4.0-generate-001');
    expect(provider.id).toBe('gemini');
    expect(model.id).toBe('imagen-4.0-generate-001');
  });

  it('prefers config.imageGeneration.defaultModel over the chat default', () => {
    const { provider, model } = resolveImageProvider(
      configWith({
        imageGeneration: {
          defaultModel: {
            protocol: 'google-gemini',
            providerId: 'gemini',
            modelId: 'imagen-4.0-generate-001',
          },
        },
      }),
      undefined,
    );
    expect(provider.id).toBe('gemini');
    expect(model.id).toBe('imagen-4.0-generate-001');
  });

  it('falls back to the chat default when no image-generation default is set (backward compat)', () => {
    const { provider, model } = resolveImageProvider(configWith({}), undefined);
    expect(provider.id).toBe('openai');
    expect(model.id).toBe('gpt-image-1');
  });

  it('throws a config error for an unknown model name', () => {
    expect(() => resolveImageProvider(configWith({}), 'nope-9')).toThrow(/model/i);
  });
});

describe('callImageEndpoint', () => {
  it('routes openai-compatible to /images/generations and returns bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    });
    const bytes = await callImageEndpoint(
      openAiProvider,
      openAiProvider.models[0]!,
      { prompt: 'a cat' },
      'sk-test',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('routes gemini imagen to :predict and reads bytesBase64Encoded', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ predictions: [{ bytesBase64Encoded: 'd29ybGQ=' }] }),
    });
    const bytes = await callImageEndpoint(
      geminiProvider,
      geminiProvider.models[0]!,
      { prompt: 'a dog' },
      'sk-gem',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain('models/imagen-4.0-generate-001:predict');
    expect(new TextDecoder().decode(bytes)).toBe('world');
  });

  it('routes to a custom path from model routes when configured', async () => {
    const providerWithRoute = {
      ...openAiProvider,
      models: [
        {
          ...openAiProvider.models[0]!,
          routes: { 'image-generation': { path: '/custom/path' } },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    });
    const bytes = await callImageEndpoint(
      providerWithRoute,
      providerWithRoute.models[0]!,
      { prompt: 'a cat' },
      'sk-test',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/custom/path',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(new TextDecoder().decode(bytes)).toBe('hello');
  });

  it('normalizes a custom route path missing its leading slash', async () => {
    const providerWithRoute = {
      ...openAiProvider,
      models: [
        {
          ...openAiProvider.models[0]!,
          routes: { 'image-generation': { path: 'images/custom' } },
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    });
    await callImageEndpoint(
      providerWithRoute,
      providerWithRoute.models[0]!,
      { prompt: 'a cat' },
      'sk-test',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/custom',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects an absolute URL as a custom route path before fetching', async () => {
    const providerWithRoute = {
      ...openAiProvider,
      models: [
        {
          ...openAiProvider.models[0]!,
          routes: { 'image-generation': { path: 'https://other.example/v1/images' } },
        },
      ],
    };
    const fetchMock = vi.fn();
    await expect(
      callImageEndpoint(
        providerWithRoute,
        providerWithRoute.models[0]!,
        { prompt: 'a cat' },
        'sk-test',
        undefined,
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toBeInstanceOf(ImageGenConfigError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes an AbortSignal timeout to the fetch call', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    });
    await callImageEndpoint(
      openAiProvider,
      openAiProvider.models[0]!,
      { prompt: 'a cat' },
      'sk-test',
      undefined,
      fetchMock as unknown as typeof fetch,
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects anthropic-compatible with a clear unsupported error', async () => {
    const anthropic = {
      id: 'anthropic',
      protocol: 'anthropic-compatible' as const,
      name: 'Anthropic',
      baseUrl: 'https://api.anthropic.com',
      models: [{ id: 'claude-image-1' }],
    };
    await expect(
      callImageEndpoint(anthropic, anthropic.models[0]!, { prompt: 'x' }, 'key'),
    ).rejects.toThrow(/not support|unsupported/i);
  });
});

describe('buildImageGenTool', () => {
  it('returns null when no image model can be resolved at build time', () => {
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

  it('returns a structured media attachment for the saved image', async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), 'piwin-image-gen-'));
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const tool = buildImageGenTool({
        piwinRoot: '/tmp/piwin',
        sessionId: 'session-1',
        config: configWith({}),
        mediaConfig: {
          mediaRoot,
          maxPasteBytes: 10_000_000,
          allowedMimeTypes: ['image/png'],
        },
        secretResolver: { resolveProviderSecret: async () => 'key' } as never,
      });
      expect(tool).not.toBeNull();
      if (!tool) {
        throw new Error('image_gen tool should be available');
      }

      const result = await tool.execute({ prompt: 'a cat' }, new AbortController().signal, {
        sessionId: 'session-1',
        runtimeGenerationId: 'generation-1',
        runId: 'run-1',
        toolName: 'image_gen',
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        throw new Error(result.message);
      }
      expect(result.details?.attachments).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          kind: 'media',
          path: expect.stringContaining(`${mediaRoot}/session-1/`),
          mimeType: 'image/png',
          byteSize: 5,
          source: 'generated',
        }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
