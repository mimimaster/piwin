import { describe, expect, it } from 'vitest';
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  completeNativeModelWebSearch,
  NativeModelWebSearchError,
} from './native-model-web-search.js';
import type { NativeSearchStreamSimple } from './native-web-search.js';

function googleProvider(): ModelProviderConfig {
  return {
    id: 'gemini',
    name: 'Gemini',
    protocol: 'google-gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      {
        id: 'gemini-search',
        capabilities: ['chat', 'native-web-search'],
      },
    ],
  };
}

describe('completeNativeModelWebSearch', () => {
  it('forces native search and returns assistant text through the structural port', async () => {
    let outboundPayload: unknown;
    const streamSimple: NativeSearchStreamSimple = (model, _context, options) => ({
      async result() {
        outboundPayload = await options?.onPayload?.(
          { model: model.id, config: { tools: [] } },
          model,
        );
        return {
          role: 'assistant',
          stopReason: 'stop',
          content: [
            {
              type: 'text',
              text: '{"hits":[{"title":"Piwin","url":"https://example.com","snippet":"Result"}]}',
            },
          ],
        };
      },
    });

    const text = await completeNativeModelWebSearch(
      {
        provider: googleProvider(),
        modelId: 'gemini-search',
        apiKey: 'test-key',
        query: 'latest piwin news',
        maxResults: 5,
      },
      { streamSimple },
    );

    expect(text).toContain('https://example.com');
    expect(outboundPayload).toMatchObject({
      config: { tools: [{ googleSearch: {} }] },
    });
  });

  it('rejects an untagged delegate model before starting a provider request', async () => {
    const provider = googleProvider();
    const model = provider.models[0];
    if (!model) throw new Error('test model missing');
    model.capabilities = ['chat'];

    await expect(
      completeNativeModelWebSearch({
        provider,
        modelId: model.id,
        apiKey: 'test-key',
        query: 'query',
        maxResults: 5,
      }),
    ).rejects.toBeInstanceOf(NativeModelWebSearchError);
  });

  it('maps provider error results to a stable boundary error', async () => {
    const streamSimple: NativeSearchStreamSimple = () => ({
      async result() {
        return {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'provider rejected request',
          content: [],
        };
      },
    });

    await expect(
      completeNativeModelWebSearch(
        {
          provider: googleProvider(),
          modelId: 'gemini-search',
          apiKey: 'test-key',
          query: 'query',
          maxResults: 5,
        },
        { streamSimple },
      ),
    ).rejects.toMatchObject({ name: 'NativeModelWebSearchError' });
  });
});
