import { describe, expect, it } from 'vitest';
import type { ModelConfigEntry, WebConfig } from '@piwin/contracts';
import {
  findReadyWebSearchDelegate,
  resolveConfiguredNativeSearchSupport,
  resolveNativeSearchAdapterSupport,
  resolveSearchRoute,
  shouldEnableNativeWebSearch,
  shouldExposeExternalWebSearch,
} from './search-route-resolver.js';

const adapterReady = resolveNativeSearchAdapterSupport(
  'openai-compatible',
  'openai-web-search-options',
  'openai-completions',
);
const adapterNoRequest = { requestSupported: false };

function nativeModel(overrides: Partial<ModelConfigEntry> = {}): ModelConfigEntry {
  return {
    id: 'search-model',
    capabilities: ['chat', 'native-web-search'],
    ...overrides,
  };
}

function externalWeb(enabled = true): Pick<WebConfig, 'searchSources' | 'searchRoutePolicy'> {
  return {
    searchSources: [{ id: 'duckduckgo', kind: 'duckduckgo', enabled }],
    searchRoutePolicy: 'external-first',
  };
}

describe('resolveSearchRoute', () => {
  it('fails closed without a protocol and reports why', () => {
    expect(resolveNativeSearchAdapterSupport(undefined)).toMatchObject({
      requestSupported: false,
      reason: expect.stringContaining('protocol is unavailable'),
    });
  });

  it('infers an adapter when the tagged model omits one', () => {
    expect(resolveNativeSearchAdapterSupport('google-gemini')).toMatchObject({
      requestSupported: true,
      adapter: 'google-search-tool',
    });
    expect(
      resolveNativeSearchAdapterSupport('openai-compatible', undefined, undefined, undefined, 'gpt-4o'),
    ).toMatchObject({
      requestSupported: true,
      adapter: 'openai-responses-tool',
    });
  });

  it('selects sources first when policy is external-first and both backends are ready', () => {
    const route = resolveSearchRoute({
      model: nativeModel(),
      web: externalWeb(true),
      adapter: adapterReady,
    });
    expect(route.policy).toBe('external-first');
    expect(route.chain).toEqual(['sources', 'native']);
    expect(route.chain[0]).toMatch(/^(sources|duckduckgo)$/);
    expect(shouldExposeExternalWebSearch(route)).toBe(true);
    expect(shouldEnableNativeWebSearch(route)).toBe(true);
  });

  it('packing default with no sources is native then DuckDuckGo', () => {
    const route = resolveSearchRoute({
      model: nativeModel(),
      web: { searchSources: [] },
      adapter: adapterReady,
    });
    expect(route.policy).toBe('native-first');
    expect(route.chain).toEqual(['native', 'duckduckgo']);
    expect(route.chain[0]).toBe('native');
    expect(shouldEnableNativeWebSearch(route)).toBe(true);
  });

  it('omitted policy with enabled sources stays external-first', () => {
    const route = resolveSearchRoute({
      model: nativeModel(),
      web: { searchSources: [{ id: 'tavily', kind: 'tavily', enabled: true }] },
      adapter: adapterReady,
    });
    expect(route.policy).toBe('external-first');
    expect(route.chain).toEqual(['sources', 'native', 'duckduckgo']);
    expect(route.chain[0]).toMatch(/^(sources|duckduckgo)$/);
  });

  it('keeps DuckDuckGo as floor under external-first when user sources are off', () => {
    const route = resolveSearchRoute({
      policy: 'external-first',
      model: nativeModel(),
      web: externalWeb(false),
      adapter: adapterReady,
    });
    expect(route.chain).toEqual(['native', 'duckduckgo']);
    expect(route.chain[0]).toBe('native');
  });

  it('treats a validated delegate model as native readiness (the native executor)', () => {
    const delegateModel = {
      protocol: 'google-gemini' as const,
      providerId: 'gemini',
      modelId: 'gemini-search',
    };
    const route = resolveSearchRoute({
      policy: 'external-first',
      model: nativeModel(),
      web: {
        ...externalWeb(false),
        searchDelegateModel: delegateModel,
      },
      delegateReady: true,
      adapter: adapterReady,
    });

    expect(route.chain[0]).toBe('native');
    expect(route.readiness.native).toMatchObject({ ready: true, hasDelegateModel: true });
    expect(route.readiness.external.ready).toBe(true);
  });

  it('reports a stale delegate as a native issue without hiding configured sources', () => {
    const route = resolveSearchRoute({
      policy: 'external-only',
      model: nativeModel(),
      web: {
        ...externalWeb(true),
        searchDelegateModel: {
          protocol: 'google-gemini',
          providerId: 'missing',
          modelId: 'missing',
        },
      },
      delegateReady: false,
      adapter: adapterReady,
    });

    expect(route.chain).toEqual(['sources']);
    expect(route.readiness.external.ready).toBe(true);
    expect(route.issues).toContain('configured web_search delegate model is unavailable');
  });

  it('selects native first under native-first when ready', () => {
    const route = resolveSearchRoute({
      policy: 'native-first',
      model: nativeModel(),
      web: { searchSources: [{ id: 'tavily', kind: 'tavily', enabled: true }] },
      adapter: adapterReady,
    });
    expect(route.chain).toEqual(['native', 'sources', 'duckduckgo']);
    expect(route.chain[0]).toBe('native');
  });

  it('falls back to sources under native-first when adapter cannot express native search', () => {
    const route = resolveSearchRoute({
      policy: 'native-first',
      model: nativeModel(),
      web: { searchSources: [{ id: 'tavily', kind: 'tavily', enabled: true }] },
      adapter: adapterNoRequest,
    });
    expect(route.chain).toEqual(['sources', 'duckduckgo']);
    expect(route.readiness.native.ready).toBe(false);
    expect(route.readiness.native.modelTagged).toBe(true);
  });

  it('native-only exposes neither when native is not ready', () => {
    const route = resolveSearchRoute({
      policy: 'native-only',
      model: { id: 'plain', capabilities: ['chat'] },
      web: externalWeb(true),
      adapter: adapterReady,
    });
    expect(route.chain).toEqual([]);
    expect(route.chain).toEqual([]);
    expect(route.issues.some((issue) => issue.includes('native-only'))).toBe(true);
  });

  it('does not treat an untagged chat model as an issue under native-first', () => {
    const route = resolveSearchRoute({
      policy: 'native-first',
      model: { id: 'plain', capabilities: ['chat'] },
      web: { searchSources: [] },
      adapter: adapterReady,
    });
    expect(route.chain).toEqual(['duckduckgo']);
    expect(route.issues).not.toContain('selected chat model is not tagged native-web-search');
  });

  it('external-only selects sources and never falls back to native', () => {
    const route = resolveSearchRoute({
      policy: 'external-only',
      model: nativeModel(),
      web: externalWeb(true),
      adapter: adapterReady,
    });
    expect(route.chain).toEqual(['sources']);
    expect(route.chain[0]).toMatch(/^(sources|duckduckgo)$/);
  });

  it('treats a model badge alone as insufficient without adapter support', () => {
    const route = resolveSearchRoute({
      policy: 'native-only',
      model: nativeModel(),
      web: externalWeb(false),
      adapter: adapterNoRequest,
    });
    expect(route.chain).toEqual([]);
    expect(route.readiness.native.modelTagged).toBe(true);
    expect(route.readiness.native.ready).toBe(false);
  });
});

describe('findReadyWebSearchDelegate', () => {
  it('accepts only an enabled configured model with both chat and native search', () => {
    const delegate = {
      protocol: 'google-gemini' as const,
      providerId: 'gemini',
      modelId: 'gemini-search',
    };
    const config = {
      providers: [
        {
          id: 'gemini',
          name: 'Gemini',
          protocol: 'google-gemini' as const,
          baseUrl: 'https://example.test',
          models: [
            nativeModel({
              id: 'gemini-search',
              nativeSearchAdapter: 'google-search-tool',
            }),
          ],
        },
      ],
      web: { searchDelegateModel: delegate },
    };

    expect(findReadyWebSearchDelegate(config)?.ref).toEqual(delegate);
    const model = config.providers[0]?.models[0];
    if (!model) throw new Error('test model missing');
    model.enabled = false;
    expect(findReadyWebSearchDelegate(config)).toBeUndefined();
  });

  it('rejects a delegate whose declared adapter the protocol cannot express', () => {
    const delegate = {
      protocol: 'openai-compatible' as const,
      providerId: 'vendor',
      modelId: 'vendor-search',
    };
    const config = {
      providers: [
        {
          id: 'vendor',
          name: 'Vendor',
          protocol: 'openai-compatible' as const,
          baseUrl: 'https://vendor.example.test',
          models: [
            nativeModel({
              id: 'vendor-search',
              nativeSearchAdapter: 'google-search-tool',
            }),
          ],
        },
      ],
      web: { searchDelegateModel: delegate },
    };

    expect(findReadyWebSearchDelegate(config)).toBeUndefined();
  });
});

describe('resolveNativeSearchAdapterSupport (adapter decoupling)', () => {
  it('infers a protocol default when no adapter is declared', () => {
    expect(resolveNativeSearchAdapterSupport('openai-compatible').requestSupported).toBe(true);
    expect(resolveNativeSearchAdapterSupport('anthropic-compatible').requestSupported).toBe(true);
    expect(resolveNativeSearchAdapterSupport('google-gemini').requestSupported).toBe(true);
  });

  it('accepts OpenAI adapters regardless of chat transport', () => {
    expect(
      resolveNativeSearchAdapterSupport(
        'openai-compatible',
        'openai-web-search-options',
        'openai-completions',
      ).requestSupported,
    ).toBe(true);
    expect(
      resolveNativeSearchAdapterSupport(
        'openai-compatible',
        'openai-responses-tool',
        'openai-completions',
      ).requestSupported,
    ).toBe(true);
    expect(
      resolveNativeSearchAdapterSupport(
        'openai-compatible',
        'xai-web-search-tool',
        'openai-completions',
      ).requestSupported,
    ).toBe(true);
    expect(
      resolveNativeSearchAdapterSupport(
        'anthropic-compatible',
        'anthropic-web-search-tool',
        'anthropic-messages',
      ).requestSupported,
    ).toBe(true);
    expect(
      resolveNativeSearchAdapterSupport(
        'google-gemini',
        'google-search-tool',
        'google-generative-ai',
      ).requestSupported,
    ).toBe(true);

    expect(
      resolveNativeSearchAdapterSupport(
        'openai-compatible',
        'anthropic-web-search-tool',
        'openai-responses',
      ).requestSupported,
    ).toBe(false);
  });

  it('never guesses an unknown mechanism', () => {
    expect(
      resolveNativeSearchAdapterSupport(
        'openai-compatible',
        'future-adapter' as never,
      ).requestSupported,
    ).toBe(false);
  });

  it('always exposes web_search when any backend is ready; fallback only outside native-only', () => {
    const nativeFirst = resolveSearchRoute({
      policy: 'native-first',
      model: nativeModel(),
      web: externalWeb(false),
      adapter: adapterReady,
    });
    expect(shouldExposeExternalWebSearch(nativeFirst)).toBe(true);
    expect(nativeFirst.chain).toEqual(['native', 'duckduckgo']);
    const nativeOnly = resolveSearchRoute({
      policy: 'native-only',
      model: nativeModel(),
      web: externalWeb(true),
      adapter: adapterReady,
    });
    expect(shouldExposeExternalWebSearch(nativeOnly)).toBe(true);
    expect(nativeOnly.chain).toEqual(['native']);
  });

  it('a tagged subscription without a Host-reachable surface is not native-ready', () => {
    const tagged = {
      id: 'claude-x',
      capabilities: ['chat', 'native-web-search'],
      nativeSearchAdapter: 'anthropic-web-search-tool',
    } as const;
    const claudeCode = resolveConfiguredNativeSearchSupport({
      provider: {
        id: 'anthropic-claude-code',
        name: 'Claude Code',
        protocol: 'anthropic-compatible',
        baseUrl: 'https://api.anthropic.com',
        source: 'subscription',
        models: [{ ...tagged, capabilities: [...tagged.capabilities] }],
      },
      model: { ...tagged, capabilities: [...tagged.capabilities] },
    });
    expect(claudeCode.requestSupported).toBe(false);
    expect(claudeCode.reason).toMatch(/no Host-reachable endpoint/);

    const grok = resolveConfiguredNativeSearchSupport({
      provider: {
        id: 'xai',
        name: 'Grok',
        protocol: 'openai-compatible',
        baseUrl: 'oauth://xai',
        source: 'subscription',
        models: [{ id: 'grok-4.7', capabilities: ['chat', 'native-web-search'] }],
      },
      model: { id: 'grok-4.7', capabilities: ['chat', 'native-web-search'] },
    });
    expect(grok).toEqual({ requestSupported: true, adapter: 'xai-web-search-tool' });
  });

  it('explains that a Gemini model on an OpenAI gateway row needs the Gemini protocol', () => {
    const provider = {
      id: 'cpa',
      name: 'CPA',
      protocol: 'openai-compatible' as const,
      baseUrl: 'http://127.0.0.1:8317/v1',
      models: [],
    };
    const model = { id: 'gemini-3.8-flash-high', capabilities: ['chat' as const, 'native-web-search' as const] };
    const inherited = resolveConfiguredNativeSearchSupport({ provider, model });
    expect(inherited.requestSupported).toBe(false);
    expect(inherited.reason).toBe(
      'native web search for gemini-3.8-flash-high needs the google-gemini request protocol',
    );
    const switched = resolveConfiguredNativeSearchSupport({
      provider,
      model: { ...model, protocol: 'google-gemini' },
    });
    expect(switched).toEqual({ requestSupported: true, adapter: 'google-search-tool' });
  });
});
