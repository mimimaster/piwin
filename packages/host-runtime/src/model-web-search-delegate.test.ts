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
          nativeSearchAdapter: 'google-search-tool',
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
    const complete = vi.fn(async (_request: NativeModelWebSearchRequest) => ({
      query: 'latest result',
      providerId: 'gemini',
      hits: [{ title: 'Gemini result', url: 'https://example.com/result', snippet: 'fresh' }],
    }));
    const delegate = buildWebSearchModelDelegate(
      configWithDelegate(),
      { resolveProviderSecret },
      { complete },
    );

    expect(delegate).toBeDefined();
    expect(resolveProviderSecret).not.toHaveBeenCalled();
    const result = await delegate?.search('latest result', { limit: 3 });

    expect(resolveProviderSecret).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: 'gemini-search',
        apiKey: 'secret',
        query: 'latest result',
        maxResults: 3,
      }),
    );
    expect(result?.hits[0]).toMatchObject({ title: 'Gemini result' });
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

  it('follows the current chat model when no fixed delegate is configured', () => {
    const config = configWithDelegate();
    if (!config.web) throw new Error('web');
    delete config.web.searchDelegateModel;
    const delegate = buildWebSearchModelDelegate(
      config,
      { resolveProviderSecret: async () => 'secret' },
      {},
      {
        chatModel: { protocol: 'google-gemini', providerId: 'gemini', modelId: 'gemini-search' },
      },
    );
    expect(delegate?.model.modelId).toBe('gemini-search');
  });

  it('infers an adapter when a tagged chat model omits one', () => {
    const config = configWithDelegate();
    if (!config.web) throw new Error('web');
    delete config.web.searchDelegateModel;
    const model = config.providers[0]?.models[0];
    if (!model) throw new Error('model');
    delete model.nativeSearchAdapter;
    expect(
      buildWebSearchModelDelegate(config, { resolveProviderSecret: async () => 'secret' }, {}, {
        chatModel: { protocol: 'google-gemini', providerId: 'gemini', modelId: 'gemini-search' },
      })?.model.modelId,
    ).toBe('gemini-search');
  });

  it('does not use a chat model whose declared adapter is incompatible', () => {
    const config = configWithDelegate();
    if (!config.web) throw new Error('web');
    delete config.web.searchDelegateModel;
    const model = config.providers[0]?.models[0];
    if (!model) throw new Error('model');
    model.nativeSearchAdapter = 'openai-responses-tool';
    expect(
      buildWebSearchModelDelegate(config, { resolveProviderSecret: async () => 'secret' }, {}, {
        chatModel: { protocol: 'google-gemini', providerId: 'gemini', modelId: 'gemini-search' },
      }),
    ).toBeUndefined();
  });
  it('sends a Grok subscription search to api.x.ai with the OAuth token', async () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'xai',
        name: 'Grok',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        source: 'subscription',
        models: [
          {
            id: 'grok-4.7',
            capabilities: ['chat', 'native-web-search'],
            nativeSearchAdapter: 'xai-web-search-tool',
          },
        ],
      },
    ];
    const resolveProviderSecret = vi.fn(async () => 'unused');
    const complete = vi.fn(async (_request: NativeModelWebSearchRequest) => ({
      query: 'weather',
      providerId: 'xai',
      hits: [],
    }));
    const delegate = buildWebSearchModelDelegate(
      config,
      { resolveProviderSecret },
      { complete, loadSubscriptionAuth: async () => ({ accessToken: 'oauth-token' }) },
      { chatModel: { protocol: 'openai-compatible', providerId: 'xai', modelId: 'grok-4.7' } },
    );
    await delegate?.search('weather', { limit: 5 });

    const request = complete.mock.calls[0]?.[0];
    expect(request?.provider.baseUrl).toBe('https://api.x.ai/v1');
    expect(request?.provider.headers).toEqual({ 'X-XAI-Token-Auth': 'xai-grok-cli' });
    expect(request?.apiKey).toBe('oauth-token');
    expect(resolveProviderSecret).not.toHaveBeenCalled();
  });
  it('runs Gemini search for a Gemini-protocol model on an OpenAI gateway row (ADR 0079)', async () => {
    const config = createDefaultPiwinConfig();
    config.providers = [
      {
        id: 'cpa',
        name: 'CPA',
        protocol: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:8317/v1',
        apiKeyRef: 'keychain:cpa',
        models: [
          {
            id: 'gemini-3.8-flash-high',
            protocol: 'google-gemini',
            capabilities: ['chat', 'native-web-search'],
          },
        ],
      },
    ];
    const complete = vi.fn(async (_request: NativeModelWebSearchRequest) => ({
      query: 'q',
      providerId: 'cpa',
      hits: [],
    }));
    const delegate = buildWebSearchModelDelegate(
      config,
      { resolveProviderSecret: async () => 'gw-key' },
      { complete },
      // ModelRef.protocol stays the provider row's protocol.
      { chatModel: { protocol: 'openai-compatible', providerId: 'cpa', modelId: 'gemini-3.8-flash-high' } },
    );
    expect(delegate).toBeDefined();
    await delegate?.search('q', { limit: 3 });
    const request = complete.mock.calls[0]?.[0];
    expect(request?.provider).toMatchObject({
      protocol: 'google-gemini',
      baseUrl: 'http://127.0.0.1:8317/v1beta',
    });
    expect(request?.apiKey).toBe('gw-key');
  });
});
