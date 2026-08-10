import { describe, expect, it } from 'vitest';
import type { ModelConfigEntry, WebConfig } from '@piwin/contracts';
import {
  defaultNativeSearchAdapterSupport,
  formatSearchRouteCapabilityBrief,
  resolveSearchRoute,
  shouldEnableNativeWebSearch,
  shouldExposeExternalWebSearch,
} from './search-route-resolver.js';

const adapterReady = defaultNativeSearchAdapterSupport();
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
  };
}

describe('resolveSearchRoute', () => {
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

  it('marks external-only incompatible for always-on native models and keeps native', () => {
    const route = resolveSearchRoute({
      policy: 'external-only',
      model: nativeModel({ nativeWebSearchMode: 'always-on' }),
      web: externalWeb(true),
      adapter: adapterReady,
    });
    expect(route.incompatible).toBe(true);
    expect(route.selected).toBe('native');
    expect(route.readiness.native.alwaysOn).toBe(true);
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
    expect(
      route.issues.some((issue) => issue.includes('citation normalization')),
    ).toBe(true);
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
