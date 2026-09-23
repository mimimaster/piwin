import type { WebConfig } from '@piwin/contracts';
import { inferSearchRoutePolicy, isWebSearchSourceKind } from '@piwin/contracts';
import {
  asPositiveInteger,
  asPositiveNumber,
  asRecord,
  asStringArray,
  normalizeModelRef,
} from './config-store-primitives.js';

/**
 * Normalize `PiwinConfig.web`: search route, sources (incl. legacy migration), and fetch fallback.
 */

export function normalizeWebConfig(value: unknown, defaults: WebConfig): WebConfig {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  const provider = record.searchProvider;
  const searchProvider =
    provider === 'duckduckgo' ||
    provider === 'brave' ||
    provider === 'tavily' ||
    provider === 'searxng' ||
    provider === 'cli' ||
    provider === 'http' ||
    provider === 'aggregate' ||
    provider === 'none'
      ? provider
      : defaults.searchProvider;
  const fetchProviderRaw = record.fetchProvider;
  const fetchProvider =
    fetchProviderRaw === 'supermarkdown' ||
    fetchProviderRaw === 'jina' ||
    fetchProviderRaw === 'firecrawl'
      ? fetchProviderRaw
      : defaults.fetchProvider;
  const searchApiKeyEnv =
    typeof record.searchApiKeyEnv === 'string' && record.searchApiKeyEnv.length > 0
      ? record.searchApiKeyEnv
      : defaults.searchApiKeyEnv;
  const searchSources = normalizeSearchSources(
    record.searchSources,
    searchProvider,
    searchApiKeyEnv,
    defaults.searchSources,
  );
  const searchStrategy = normalizeSearchStrategy(record.searchStrategy, defaults.searchStrategy);
  const searchRoutePolicy = inferSearchRoutePolicy(record.searchRoutePolicy, searchSources);
  const mirroredProvider = mirrorSearchProviderFromSources(searchSources, searchProvider);
  const normalized: WebConfig = {
    searchProvider: mirroredProvider,
    searchApiKeyEnv,
    searchMaxResults: asPositiveNumber(record.searchMaxResults) ?? defaults.searchMaxResults,
    searchTimeoutMs: asPositiveNumber(record.searchTimeoutMs) ?? defaults.searchTimeoutMs,
    searchSources,
    searchStrategy,
    searchRoutePolicy,
    fetchProvider,
    fetchApiKeyEnv:
      typeof record.fetchApiKeyEnv === 'string' && record.fetchApiKeyEnv.length > 0
        ? record.fetchApiKeyEnv
        : defaults.fetchApiKeyEnv,
    fetchMaxBytes: asPositiveNumber(record.fetchMaxBytes) ?? defaults.fetchMaxBytes,
    fetchTimeoutMs: asPositiveNumber(record.fetchTimeoutMs) ?? defaults.fetchTimeoutMs,
    fetchBlockedUrlPrefixes:
      asStringArray(record.fetchBlockedUrlPrefixes) ?? defaults.fetchBlockedUrlPrefixes,
  };
  const searchDelegateModel = normalizeModelRef(record.searchDelegateModel);
  if (searchDelegateModel) {
    normalized.searchDelegateModel = searchDelegateModel;
  }
  const fetchDelegateModel = normalizeModelRef(record.fetchDelegateModel);
  if (fetchDelegateModel) {
    normalized.fetchDelegateModel = fetchDelegateModel;
  }
  if (typeof record.fetchApiKeyRef === 'string' && record.fetchApiKeyRef.trim()) {
    normalized.fetchApiKeyRef = record.fetchApiKeyRef.trim();
  }
  const fetchReturnMaxChars =
    asPositiveInteger(record.fetchReturnMaxChars) ?? defaults.fetchReturnMaxChars;
  if (fetchReturnMaxChars !== undefined) {
    normalized.fetchReturnMaxChars = fetchReturnMaxChars;
  }
  const fetchStoreMaxChars =
    asPositiveInteger(record.fetchStoreMaxChars) ?? defaults.fetchStoreMaxChars;
  if (fetchStoreMaxChars !== undefined) {
    normalized.fetchStoreMaxChars = fetchStoreMaxChars;
  }
  const fetchCacheTtlMs = asPositiveInteger(record.fetchCacheTtlMs) ?? defaults.fetchCacheTtlMs;
  if (fetchCacheTtlMs !== undefined) {
    normalized.fetchCacheTtlMs = fetchCacheTtlMs;
  }
  const fetchFallback = normalizeFetchFallback(record.fetchFallback, defaults.fetchFallback);
  if (fetchFallback !== undefined) {
    normalized.fetchFallback = fetchFallback;
  }
  return normalized;
}

export function normalizeFetchFallback(
  value: unknown,
  defaults: WebConfig['fetchFallback'],
): WebConfig['fetchFallback'] {
  if (value === 'none' || value === 'jina' || value === 'browser') {
    return value;
  }
  return defaults;
}

export function normalizeSearchStrategy(
  value: unknown,
  defaults: WebConfig['searchStrategy'],
): WebConfig['searchStrategy'] {
  const record = asRecord(value);
  if (!record) {
    return defaults;
  }
  // Multi-source search is always parallel; legacy ordered-fallback normalizes here.
  return {
    mode: 'parallel',
    perSourceTimeoutMs: asPositiveNumber(record.perSourceTimeoutMs) ?? defaults.perSourceTimeoutMs,
  };
}

export function normalizeSearchSources(
  value: unknown,
  legacyProvider: WebConfig['searchProvider'],
  legacyApiKeyEnv: string,
  defaults: WebConfig['searchSources'],
): WebConfig['searchSources'] {
  if (Array.isArray(value)) {
    const parsed = value
      .map((item) => normalizeOneSearchSource(item))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (parsed.length > 0) {
      return parsed;
    }
  }
  // Migrate legacy single-provider configs that predate searchSources.
  return migrateLegacySearchSources(legacyProvider, legacyApiKeyEnv, defaults);
}

export function migrateLegacySearchSources(
  provider: WebConfig['searchProvider'],
  apiKeyEnv: string,
  defaults: WebConfig['searchSources'],
): WebConfig['searchSources'] {
  if (provider === 'none') {
    return [];
  }
  if (provider === 'brave') {
    return [
      {
        id: 'brave',
        kind: 'brave',
        enabled: true,
        apiKeyEnv: apiKeyEnv || 'BRAVE_API_KEY',
      },
    ];
  }
  if (provider === 'tavily') {
    return [
      {
        id: 'tavily',
        kind: 'tavily',
        enabled: true,
        apiKeyEnv: apiKeyEnv || 'TAVILY_API_KEY',
      },
    ];
  }
  if (provider === 'searxng') {
    return [{ id: 'searxng', kind: 'searxng', enabled: true }];
  }
  if (provider === 'cli') {
    return [{ id: 'cli', kind: 'cli', enabled: true }];
  }
  if (provider === 'http') {
    return [{ id: 'http', kind: 'http', enabled: true }];
  }
  if (provider === 'aggregate') {
    return defaults.length > 0
      ? defaults
      : [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }];
  }
  if (provider === 'duckduckgo') {
    return [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }];
  }
  return defaults;
}

export function normalizeOneSearchSource(
  value: unknown,
): WebConfig['searchSources'][number] | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const kind = record.kind;
  if (!isWebSearchSourceKind(kind)) {
    return null;
  }
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : kind;
  const source: WebConfig['searchSources'][number] = {
    id,
    kind,
    enabled: record.enabled !== false,
  };
  if (typeof record.label === 'string' && record.label.trim()) {
    source.label = record.label.trim();
  }
  if (typeof record.apiKeyEnv === 'string' && record.apiKeyEnv.trim()) {
    source.apiKeyEnv = record.apiKeyEnv.trim();
  }
  if (typeof record.apiKeyRef === 'string' && record.apiKeyRef.trim()) {
    source.apiKeyRef = record.apiKeyRef.trim();
  }
  if (typeof record.baseUrl === 'string' && record.baseUrl.trim()) {
    source.baseUrl = record.baseUrl.trim();
  }
  if (typeof record.command === 'string' && record.command.trim()) {
    source.command = record.command.trim();
  }
  if (Array.isArray(record.args)) {
    source.args = record.args.filter((item): item is string => typeof item === 'string');
  }
  if (record.env && typeof record.env === 'object' && !Array.isArray(record.env)) {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(record.env as Record<string, unknown>)) {
      if (key.trim() && typeof value === 'string') {
        env[key] = value;
      }
    }
    if (Object.keys(env).length > 0) {
      source.env = env;
    }
  }
  return source;
}

export function mirrorSearchProviderFromSources(
  sources: WebConfig['searchSources'],
  fallback: WebConfig['searchProvider'],
): WebConfig['searchProvider'] {
  const enabled = sources.filter((source) => source.enabled);
  if (enabled.length === 0) {
    return 'none';
  }
  if (enabled.length > 1) {
    return 'aggregate';
  }
  const only = enabled[0];
  return only?.kind ?? fallback;
}
