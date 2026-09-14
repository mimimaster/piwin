import { describe, expect, it, vi } from 'vitest';
import type { OpenAiCompatibleProviderConfig } from '@piwin/contracts';
import { testImageGenerationModel } from './image-generation-test.js';

const provider: OpenAiCompatibleProviderConfig = {
  id: 'images',
  protocol: 'openai-compatible',
  name: 'Images',
  baseUrl: 'https://images.example/v1',
  apiKeyEnv: 'IMAGE_KEY',
  models: [{ id: 'image-1', capabilities: ['image-generation'] }],
};

const grokProvider: OpenAiCompatibleProviderConfig = {
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

function jpegResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        {
          b64_json: Buffer.from(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])).toString('base64'),
        },
      ],
    }),
  } as Response;
}

describe('testImageGenerationModel', () => {
  it('uses the generation adapter and returns metadata without image bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            b64_json: Buffer.from(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])).toString('base64'),
          },
        ],
      }),
    } as Response);
    let currentTime = 100;
    const result = await testImageGenerationModel(provider, 'image-1', undefined, {
      secretResolver: { resolveProviderSecret: async () => 'secret' },
      fetch: fetchMock as unknown as typeof fetch,
      now: () => {
        currentTime += 25;
        return currentTime;
      },
    });

    expect(result).toEqual({
      providerId: 'images',
      modelId: 'image-1',
      durationMs: 25,
      imageCount: 1,
      outputs: [{ mimeType: 'image/jpeg', byteSize: 4 }],
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('b64_json');
  });

  it('rejects chat-only models before making a network request', async () => {
    const fetchMock = vi.fn();
    await expect(
      testImageGenerationModel(
        { ...provider, models: [{ id: 'chat', capabilities: ['chat'] }] },
        'chat',
        undefined,
        {
          secretResolver: { resolveProviderSecret: async () => 'secret' },
          fetch: fetchMock as unknown as typeof fetch,
        },
      ),
    ).rejects.toThrow(/enabled image model/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attaches Grok subscription OAuth instead of sending an empty request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jpegResponse());
    const resolveProviderSecret = vi.fn();
    const loadSubscriptionMediaAuth = vi.fn().mockResolvedValue({ accessToken: 'grok-token' });

    await testImageGenerationModel(grokProvider, 'grok-imagine-image-2.0', undefined, {
      secretResolver: { resolveProviderSecret },
      fetch: fetchMock as unknown as typeof fetch,
      piwinRoot: '/tmp/piwin-image-test',
      loadSubscriptionMediaAuth,
    });

    expect(resolveProviderSecret).not.toHaveBeenCalled();
    expect(loadSubscriptionMediaAuth).toHaveBeenCalledWith('xai', {
      piwinRoot: '/tmp/piwin-image-test',
    });
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

  it('fails with the OAuth login error instead of a naked 401', async () => {
    const fetchMock = vi.fn();
    await expect(
      testImageGenerationModel(grokProvider, 'grok-imagine-image-2.0', undefined, {
        secretResolver: { resolveProviderSecret: async () => 'unused' },
        fetch: fetchMock as unknown as typeof fetch,
        loadSubscriptionMediaAuth: async () => {
          throw new Error('未找到 xai 的 OAuth 凭据，请先登录套餐');
        },
      }),
    ).rejects.toThrow(/未找到 xai 的 OAuth 凭据/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses a one-shot key for an otherwise no-auth provider', async () => {
    const noAuthProvider: OpenAiCompatibleProviderConfig = { ...provider };
    delete noAuthProvider.apiKeyEnv;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            b64_json: Buffer.from(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])).toString('base64'),
          },
        ],
      }),
    } as Response);
    const resolveProviderSecret = vi.fn();
    await testImageGenerationModel(noAuthProvider, 'image-1', 'test', {
      secretResolver: { resolveProviderSecret },
      apiKey: 'one-shot',
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(resolveProviderSecret).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual(
      expect.objectContaining({ authorization: 'Bearer one-shot' }),
    );
  });
});
