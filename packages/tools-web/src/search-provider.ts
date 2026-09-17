import type {
  SearchHit,
  WebConfig,
  WebSearchDiagnostics,
  WebSearchProvider,
  WebSearchResult,
  WebSearchSource,
  WebSearchSourceAttempt,
  WebSearchStrategy,
} from '@piwin/contracts';
import {
  DEFAULT_FETCH_FALLBACK,
  WEB_SEARCH_ATTEMPT_ERROR_MAX_CHARS,
  WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
  createDefaultWebConfig,
  inferSearchRoutePolicy,
} from '@piwin/contracts';
import { mergeSearchHitBatches, type SourceHitBatch } from './search-merge.js';
import { createProviderForSource, type SearchProvider } from './search-source-providers.js';
import type { WebRuntimeCredentials } from './runtime-credentials.js';
import { sameModelRef, type WebSearchModelDelegate } from './model-search-delegate.js';

export type { SearchProvider } from './search-source-providers.js';

export function resolveWebConfig(partial?: Partial<WebConfig> | undefined): WebConfig {
  const defaults = createDefaultWebConfig();
  if (!partial) {
    return defaults;
  }
  const searchSources = resolveSearchSources(partial, defaults);
  const searchStrategy = resolveSearchStrategy(partial.searchStrategy, defaults.searchStrategy);
  const searchProvider = mirrorSearchProvider(searchSources, partial.searchProvider);
  return {
    searchProvider,
    searchApiKeyEnv: partial.searchApiKeyEnv ?? defaults.searchApiKeyEnv,
    searchMaxResults: partial.searchMaxResults ?? defaults.searchMaxResults,
    searchTimeoutMs: partial.searchTimeoutMs ?? defaults.searchTimeoutMs,
    searchSources,
    ...(partial.searchDelegateModel ? { searchDelegateModel: partial.searchDelegateModel } : {}),
    ...(partial.fetchDelegateModel ? { fetchDelegateModel: partial.fetchDelegateModel } : {}),
    searchStrategy,
    searchRoutePolicy: inferSearchRoutePolicy(partial.searchRoutePolicy, searchSources),
    fetchProvider: partial.fetchProvider ?? defaults.fetchProvider,
    fetchFallback: partial.fetchFallback ?? defaults.fetchFallback ?? DEFAULT_FETCH_FALLBACK,
    ...(partial.fetchApiKeyRef ? { fetchApiKeyRef: partial.fetchApiKeyRef } : {}),
    fetchApiKeyEnv: partial.fetchApiKeyEnv ?? defaults.fetchApiKeyEnv,
    fetchMaxBytes: partial.fetchMaxBytes ?? defaults.fetchMaxBytes,
    ...(partial.fetchReturnMaxChars !== undefined
      ? { fetchReturnMaxChars: partial.fetchReturnMaxChars }
      : {}),
    ...(partial.fetchStoreMaxChars !== undefined
      ? { fetchStoreMaxChars: partial.fetchStoreMaxChars }
      : {}),
    ...(partial.fetchCacheTtlMs !== undefined ? { fetchCacheTtlMs: partial.fetchCacheTtlMs } : {}),
    fetchTimeoutMs: partial.fetchTimeoutMs ?? defaults.fetchTimeoutMs,
    fetchBlockedUrlPrefixes: partial.fetchBlockedUrlPrefixes ?? defaults.fetchBlockedUrlPrefixes,
  };
}

/**
 * Build the runtime provider used by web_search.
 * Multiple enabled sources → aggregate; zero → disabled; one → that source.
 */
export function createSearchProvider(
  config: WebConfig | Partial<WebConfig>,
  credentials: WebRuntimeCredentials = {},
  delegate?: WebSearchModelDelegate,
): SearchProvider {
  const resolved = resolveWebConfig(config);
  if (resolved.searchDelegateModel) {
    const selectedModel = resolved.searchDelegateModel;
    const providerId = `model-delegate:${selectedModel.providerId}/${selectedModel.modelId}`;
    return {
      id: providerId,
      async search(query, options): Promise<SearchHit[]> {
        if (!delegate || !sameModelRef(delegate.model, selectedModel)) {
          throw new Error(
            `web search delegate is unavailable: ${selectedModel.providerId}/${selectedModel.modelId}`,
          );
        }
        return delegate.search(query, options);
      },
    };
  }
  const enabled = resolved.searchSources.filter((source) => source.enabled);
  if (enabled.length === 0) {
    return {
      id: 'none',
      async search(): Promise<SearchHit[]> {
        throw new Error(
          'web search disabled (no enabled searchSources). Configure sources in Settings → Web or ~/.piwin/config.json',
        );
      },
    };
  }
  if (enabled.length === 1) {
    const only = enabled[0];
    if (!only) {
      throw new Error('web search: enabled source list was empty after filter');
    }
    return createProviderForSource(only, credentials.searchApiKeysBySourceId?.[only.id]);
  }
  return createAggregateProvider(
    enabled,
    resolved.searchStrategy,
    resolved.searchMaxResults,
    credentials,
  );
}

export async function webSearch(
  query: string,
  config?: Partial<WebConfig>,
  signal?: AbortSignal,
  credentials: WebRuntimeCredentials = {},
  delegate?: WebSearchModelDelegate,
): Promise<WebSearchResult> {
  const { result } = await webSearchWithDiagnostics(query, config, signal, credentials, delegate);
  return result;
}

/** A failed search that still carries whatever per-source outcome was observed. */
export class WebSearchError extends Error {
  readonly diagnostics: WebSearchDiagnostics;

  constructor(message: string, diagnostics: WebSearchDiagnostics, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WebSearchError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Same as {@link webSearch}, plus per-source outcome and timing for the product
 * UI. Failures throw {@link WebSearchError} with the attempts seen so far.
 */
export async function webSearchWithDiagnostics(
  query: string,
  config?: Partial<WebConfig>,
  signal?: AbortSignal,
  credentials: WebRuntimeCredentials = {},
  delegate?: WebSearchModelDelegate,
): Promise<{ result: WebSearchResult; diagnostics: WebSearchDiagnostics }> {
  const resolved = resolveWebConfig(config);
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('empty search query');
  }
  let provider: SearchProvider;
  try {
    provider = createSearchProvider(resolved, credentials, delegate);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WebSearchError(
      message,
      {
        kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
        providerId: 'unconfigured',
        hitCount: 0,
        durationMs: 0,
        attempts: [],
      },
      { cause: error },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.searchTimeoutMs);
  const searchSignal = signal ? anySignal([signal, controller.signal]) : controller.signal;
  const attempts: WebSearchSourceAttempt[] = [];
  const startedAt = Date.now();

  try {
    const hits = await provider.search(trimmed, {
      limit: resolved.searchMaxResults,
      signal: searchSignal,
      onSourceAttempt: (attempt) => attempts.push(attempt),
    });
    const durationMs = Date.now() - startedAt;
    const result: WebSearchResult = {
      query: trimmed,
      providerId: provider.id,
      hits,
    };
    if (hits.length === 0) {
      result.warning = `No results returned by ${provider.id} for "${trimmed}". The query may be too specific, or sources may be rate-limited.`;
    }
    if (attempts.length === 0) {
      // Single source or model delegate: the whole call is the one attempt.
      attempts.push({ sourceId: provider.id, ok: true, hitCount: hits.length, durationMs });
    }
    return {
      result,
      diagnostics: {
        kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
        providerId: provider.id,
        hitCount: hits.length,
        durationMs,
        attempts,
      },
    };
  } catch (error) {
    const timedOut = searchSignal.aborted && !signal?.aborted;
    const message = searchSignal.aborted
      ? `web search timed out after ${resolved.searchTimeoutMs}ms (provider ${provider.id})`
      : error instanceof Error
        ? error.message
        : String(error);
    const durationMs = Date.now() - startedAt;
    if (attempts.length === 0) {
      attempts.push({
        sourceId: provider.id,
        ok: false,
        hitCount: 0,
        durationMs,
        ...(timedOut ? { timedOut: true } : {}),
        error: message.slice(0, WEB_SEARCH_ATTEMPT_ERROR_MAX_CHARS),
      });
    }
    throw new WebSearchError(
      message,
      {
        kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
        providerId: provider.id,
        hitCount: 0,
        durationMs,
        attempts,
      },
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function createAggregateProvider(
  sources: WebSearchSource[],
  strategy: WebSearchStrategy,
  defaultLimit: number,
  credentials: WebRuntimeCredentials,
): SearchProvider {
  const sourceIds = sources.map((source) => source.id).join('+');
  return {
    id: sources.length > 1 ? `aggregate:${sourceIds}` : (sources[0]?.id ?? 'aggregate'),
    async search(query, options) {
      const limit = options.limit > 0 ? options.limit : defaultLimit;
      return runParallelMerge(
        sources,
        query,
        limit,
        strategy.perSourceTimeoutMs,
        options.signal,
        credentials,
        options.onSourceAttempt,
      );
    },
  };
}

async function runParallelMerge(
  sources: WebSearchSource[],
  query: string,
  limit: number,
  perSourceTimeoutMs: number,
  parentSignal?: AbortSignal,
  credentials: WebRuntimeCredentials = {},
  onSourceAttempt?: (attempt: WebSearchSourceAttempt) => void,
): Promise<SearchHit[]> {
  const settled = await Promise.all(
    sources.map(async (source) => {
      const startedAt = Date.now();
      try {
        const hits = await runSourceWithTimeout(
          source,
          query,
          limit,
          perSourceTimeoutMs,
          parentSignal,
          credentials.searchApiKeysBySourceId?.[source.id],
        );
        return {
          sourceId: source.id,
          hits,
          error: undefined as string | undefined,
          timedOut: false,
          durationMs: Date.now() - startedAt,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          sourceId: source.id,
          hits: [] as SearchHit[],
          error: message,
          timedOut: error instanceof SourceTimeoutError,
          durationMs: Date.now() - startedAt,
        };
      }
    }),
  );
  if (onSourceAttempt) {
    for (const item of settled) {
      onSourceAttempt({
        sourceId: item.sourceId,
        ok: item.error === undefined,
        hitCount: item.hits.length,
        durationMs: item.durationMs,
        ...(item.timedOut ? { timedOut: true } : {}),
        ...(item.error !== undefined
          ? { error: item.error.slice(0, WEB_SEARCH_ATTEMPT_ERROR_MAX_CHARS) }
          : {}),
      });
    }
  }

  const batches: SourceHitBatch[] = settled
    .filter((item) => item.hits.length > 0)
    .map((item) => ({ sourceId: item.sourceId, hits: item.hits }));
  const merged = mergeSearchHitBatches(batches, limit);

  const errors = settled.filter((item) => item.error);
  if (merged.length === 0 && errors.length === sources.length) {
    const detail = errors.map((item) => `${item.sourceId}: ${item.error}`).join('; ');
    throw new Error(`All search sources failed. ${detail}`);
  }
  return merged;
}

async function runSourceWithTimeout(
  source: WebSearchSource,
  query: string,
  limit: number,
  perSourceTimeoutMs: number,
  parentSignal?: AbortSignal,
  apiKey?: string,
): Promise<SearchHit[]> {
  const provider = createProviderForSource(source, apiKey);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), perSourceTimeoutMs);
  const signal = parentSignal ? anySignal([parentSignal, controller.signal]) : controller.signal;
  try {
    return await provider.search(query, { limit, signal });
  } catch (error) {
    if (signal.aborted && !parentSignal?.aborted) {
      throw new SourceTimeoutError(`source "${source.id}" timed out after ${perSourceTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

class SourceTimeoutError extends Error {}

function resolveSearchSources(partial: Partial<WebConfig>, defaults: WebConfig): WebSearchSource[] {
  if (Array.isArray(partial.searchSources)) {
    return partial.searchSources.map(normalizeSourceRecord).filter((source) => source.id);
  }
  // Legacy single-provider migration.
  return migrateLegacySearchProvider(
    partial.searchProvider ?? defaults.searchProvider,
    partial.searchApiKeyEnv ?? defaults.searchApiKeyEnv,
  );
}

function resolveSearchStrategy(
  partial: WebSearchStrategy | undefined,
  defaults: WebSearchStrategy,
): WebSearchStrategy {
  if (!partial) {
    return defaults;
  }
  // Multi-source search is always parallel; legacy ordered-fallback normalizes here.
  const mode: WebSearchStrategy['mode'] = 'parallel';
  const perSourceTimeoutMs =
    typeof partial.perSourceTimeoutMs === 'number' && partial.perSourceTimeoutMs > 0
      ? Math.floor(partial.perSourceTimeoutMs)
      : defaults.perSourceTimeoutMs;
  return { mode, perSourceTimeoutMs };
}

function migrateLegacySearchProvider(
  provider: WebSearchProvider,
  apiKeyEnv: string,
): WebSearchSource[] {
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
    return [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }];
  }
  return [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }];
}

function mirrorSearchProvider(
  sources: WebSearchSource[],
  fallback?: WebSearchProvider,
): WebSearchProvider {
  const enabled = sources.filter((source) => source.enabled);
  if (enabled.length === 0) {
    return 'none';
  }
  if (enabled.length > 1) {
    return 'aggregate';
  }
  const only = enabled[0];
  if (!only) {
    return fallback ?? 'none';
  }
  return only.kind;
}

function normalizeSourceRecord(value: WebSearchSource): WebSearchSource {
  const kind = value.kind;
  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : kind;
  const source: WebSearchSource = {
    id,
    kind,
    enabled: value.enabled !== false,
  };
  if (typeof value.label === 'string' && value.label.trim()) {
    source.label = value.label.trim();
  }
  if (typeof value.apiKeyEnv === 'string' && value.apiKeyEnv.trim()) {
    source.apiKeyEnv = value.apiKeyEnv.trim();
  }
  if (typeof value.apiKeyRef === 'string' && value.apiKeyRef.trim()) {
    source.apiKeyRef = value.apiKeyRef.trim();
  }
  if (typeof value.baseUrl === 'string' && value.baseUrl.trim()) {
    source.baseUrl = value.baseUrl.trim();
  }
  if (typeof value.command === 'string' && value.command.trim()) {
    source.command = value.command.trim();
  }
  if (Array.isArray(value.args)) {
    source.args = value.args.filter((item): item is string => typeof item === 'string');
  }
  if (value.env && typeof value.env === 'object') {
    const env: Record<string, string> = {};
    for (const [key, envValue] of Object.entries(value.env)) {
      if (key.trim() && typeof envValue === 'string') {
        env[key] = envValue;
      }
    }
    if (Object.keys(env).length > 0) {
      source.env = env;
    }
  }
  return source;
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}
