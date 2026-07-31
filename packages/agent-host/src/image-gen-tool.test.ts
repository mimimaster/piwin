import { describe, expect, it, vi } from 'vitest';
import type { PiwinConfig } from '@piwin/contracts';
import { resolveImageProvider, callImageEndpoint, buildImageGenTool } from './image-gen-tool.js';

const openAiProvider = {
  id: 'openai',
  protocol: 'openai-compatible' as const,
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKeyEnv: 'OPENAI_API_KEY',
  models: [{ id: 'gpt-image-1', label: 'gpt-image-1' }],
};

const geminiProvider = {
  id: 'gemini',
  protocol: 'google-gemini' as const,
  name: 'Gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  apiKeyEnv: 'GEMINI_API_KEY',
  models: [{ id: 'imagen-4.0-generate-001', label: 'imagen-4.0' }],
};

const baseConfig = {
  hostMode: 'sdk' as const,
  providers: [openAiProvider, geminiProvider],
  defaultProviderId: 'openai',
  defaultModelId: 'gpt-image-1',
  media: { maxPasteBytes: 10 * 1024 * 1024, allowedMimeTypes: ['image/png', 'image/jpeg'] },
  artifact: { maxBytes: 100_000, htmlUiModeDefault: false },
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

  it('falls back to default provider/model', () => {
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
});
