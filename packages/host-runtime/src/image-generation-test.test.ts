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
