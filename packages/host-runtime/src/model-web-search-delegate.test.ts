import { describe, expect, it, vi } from 'vitest';
import type { NativeModelWebSearchRequest } from '@piwin/agent-host';
import { createDefaultPiwinConfig } from './config-store.js';
import { buildWebSearchModelDelegate } from './model-web-search-delegate.js';

function configWithDelegate() {
  const config = createDefaultPiwinConfig();
  config.providers = [
    {
      id: 'gemini',
      name: 'Gemini',
      protocol: 'google-gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKeyRef: 'keychain:gemini',
      models: [
        {
          id: 'gemini-search',
          capabilities: ['chat', 'native-web-search'],
        },
      ],
    },
  ];
  if (!config.web) throw new Error('default Web config missing');
  config.web.searchDelegateModel = {
    protocol: 'google-gemini',
    providerId: 'gemini',
    modelId: 'gemini-search',
  };
  return config;
}

describe('buildWebSearchModelDelegate', () => {
  it('resolves the provider secret lazily and normalizes model output', async () => {
    const resolveProviderSecret = vi.fn(async () => 'secret');
    const complete = vi.fn(async (_request: NativeModelWebSearchRequest) =>
      JSON.stringify({
        hits: [{ title: 'Gemini result', url: 'https://example.com/result', snippet: 'fresh' }],
      }),
    );
    const delegate = buildWebSearchModelDelegate(
      configWithDelegate(),
      { resolveProviderSecret },
      { complete },
    );

    expect(delegate).toBeDefined();
    expect(resolveProviderSecret).not.toHaveBeenCalled();
    const hits = await delegate?.search('latest result', { limit: 3 });

    expect(resolveProviderSecret).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'gemini-search',
        apiKey: 'secret',
        query: 'latest result',
        maxResults: 3,
      }),
    );
    expect(hits?.[0]).toMatchObject({
      title: 'Gemini result',
      source: 'model-delegate',
    });
  });

  it('fails closed when the selected model loses its native-search tag', () => {
    const config = configWithDelegate();
    const model = config.providers[0]?.models[0];
    if (!model) throw new Error('test model missing');
    model.capabilities = ['chat'];

    expect(
      buildWebSearchModelDelegate(config, { resolveProviderSecret: async () => 'secret' }),
    ).toBeUndefined();
  });
});
