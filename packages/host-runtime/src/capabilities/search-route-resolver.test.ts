import { describe, expect, it } from 'vitest';
import type { ModelConfigEntry, WebConfig } from '@piwin/contracts';
import {
  findReadyWebSearchDelegate,
  formatSearchRouteCapabilityBrief,
  resolveNativeSearchAdapterSupport,
  resolveSearchRoute,
  shouldEnableNativeWebSearch,
  shouldExposeExternalWebSearch,
} from './search-route-resolver.js';

const adapterReady = resolveNativeSearchAdapterSupport('openai-compatible');
const adapterNoRequest = { requestSupported: false, citationSupported: false };

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
  it('reports request support by protocol without claiming citation support', () => {
    expect(resolveNativeSearchAdapterSupport('openai-compatible')).toEqual({
      requestSupported: true,
      citationSupported: false,
    });
    expect(resolveNativeSearchAdapterSupport(undefined)).toEqual({
      requestSupported: false,
      citationSupported: false,
    });
  });

  it('defaults to external-first and selects external when both are ready', () => {
    const route = resolveSearchRoute({
      model: nativeModel(),
      web: externalWeb(true),
      adapter: adapterReady,
    });
    expect(route.policy).toBe('external-first');
    expect(route.selected).toBe('external');
    expect(route.fallback).toBe('native');
    expect(shouldExposeExternalWebSearch(route)).toBe(true);
    expect(shouldEnableNativeWebSearch(route)).toBe(false);
  });

  it('falls back to native under external-first when no external sources are ready', () => {
    const route = resolveSearchRoute({
      policy: 'external-first',
      model: nativeModel(),
      web: externalWeb(false),
      adapter: adapterReady,
    });
    expect(route.selected).toBe('native');
    expect(route.fallback).toBeNull();
  });

  it('treats a validated delegate model as the exclusive external web_search backend', () => {
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
      externalDelegateReady: true,
      adapter: adapterReady,
    });

    expect(route.selected).toBe('external');
    expect(route.readiness.external).toMatchObject({
      ready: true,
      hasEnabledSources: false,
      hasDelegateModel: true,
    });
  });

  it('fails a stale delegate closed instead of silently using configured sources', () => {
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
      externalDelegateReady: false,
      adapter: adapterReady,
    });

    expect(route.selected).toBeNull();
    expect(route.readiness.external.ready).toBe(false);
    expect(route.issues).toContain('configured web_search delegate model is unavailable');
  });

  it('selects native under native-first when ready', () => {
    const route = resolveSearchRoute({
      policy: 'native-first',
      model: nativeModel(),
      web: externalWeb(true),
      adapter: adapterReady,
    });
    expect(route.selected).toBe('native');
    expect(route.fallback).toBe('external');
  });

  it('falls back to external under native-first when adapter cannot express native search', () => {
    const route = resolveSearchRoute({
      policy: 'native-first',
      model: nativeModel(),
      web: externalWeb(true),
      adapter: adapterNoRequest,
    });
    expect(route.selected).toBe('external');
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
    expect(route.selected).toBeNull();
    expect(route.fallback).toBeNull();
    expect(route.issues.some((issue) => issue.includes('native-only'))).toBe(true);
  });

  it('external-only selects external and never falls back to native', () => {
    const route = resolveSearchRoute({
      policy: 'external-only',
      model: nativeModel(),
      web: externalWeb(true),
      adapter: adapterReady,
    });
    expect(route.selected).toBe('external');
    expect(route.fallback).toBeNull();
  });

  it('treats a model badge alone as insufficient without adapter support', () => {
    const route = resolveSearchRoute({
      policy: 'native-only',
      model: nativeModel(),
      web: externalWeb(false),
      adapter: adapterNoRequest,
    });
    expect(route.selected).toBeNull();
    expect(route.readiness.native.modelTagged).toBe(true);
    expect(route.readiness.native.ready).toBe(false);
  });

  it('keeps request readiness when citations are unsupported but request shaping works', () => {
    const route = resolveSearchRoute({
      policy: 'native-first',
      model: nativeModel(),
      web: externalWeb(false),
      adapter: { requestSupported: true, citationSupported: false },
    });
    expect(route.selected).toBe('native');
    expect(route.readiness.native.ready).toBe(true);
    expect(route.readiness.native.adapterCitationSupported).toBe(false);
    expect(route.issues.some((issue) => issue.includes('citation normalization'))).toBe(true);
  });

  it('formats a capability brief for the selected route', () => {
    const native = resolveSearchRoute({
      policy: 'native-only',
      model: nativeModel(),
      web: externalWeb(false),
      adapter: adapterReady,
    });
    expect(formatSearchRouteCapabilityBrief(native)).toContain('provider-native');
    const external = resolveSearchRoute({
      policy: 'external-only',
      model: { id: 'plain' },
      web: externalWeb(true),
      adapter: adapterReady,
    });
    expect(formatSearchRouteCapabilityBrief(external)).toContain('web_search');
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
          models: [nativeModel({ id: 'gemini-search' })],
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
});
