import type {
  SearchHit,
  WebConfig,
  WebSearchProvider,
  WebSearchResult,
  WebSearchSource,
  WebSearchStrategy,
} from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { mergeSearchHitBatches, type SourceHitBatch } from './search-merge.js';
import {
  createProviderForSource,
  type SearchProvider,
} from './search-source-providers.js';

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
    searchStrategy,
    fetchProvider: partial.fetchProvider ?? defaults.fetchProvider,
    fetchApiKeyEnv: partial.fetchApiKeyEnv ?? defaults.fetchApiKeyEnv,
    fetchMaxBytes: partial.fetchMaxBytes ?? defaults.fetchMaxBytes,
    fetchTimeoutMs: partial.fetchTimeoutMs ?? defaults.fetchTimeoutMs,
    fetchBlockedUrlPrefixes:
      partial.fetchBlockedUrlPrefixes ?? defaults.fetchBlockedUrlPrefixes,
  };
}

/**
 * Build the runtime provider used by web_search.
 * Multiple enabled sources → aggregate; zero → disabled; one → that source.
 */
export function createSearchProvider(config: WebConfig | Partial<WebConfig>): SearchProvider {
  const resolved = resolveWebConfig(config);
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
    return createProviderForSource(only);
  }
  return createAggregateProvider(enabled, resolved.searchStrategy, resolved.searchMaxResults);
}

export async function webSearch(
  query: string,
  config?: Partial<WebConfig>,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const resolved = resolveWebConfig(config);
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('empty search query');
  }
  const provider = createSearchProvider(resolved);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolved.searchTimeoutMs);
  const searchSignal = signal
    ? anySignal([signal, controller.signal])
    : controller.signal;

  try {
    const hits = await provider.search(trimmed, {
      limit: resolved.searchMaxResults,
      signal: searchSignal,
    });
    const result: WebSearchResult = {
      query: trimmed,
      providerId: provider.id,
      hits,
    };
    if (hits.length === 0) {
      result.warning = `No results returned by ${provider.id} for "${trimmed}". The query may be too specific, or sources may be rate-limited.`;
    }
    return result;
  } catch (error) {
    if (searchSignal.aborted) {
      throw new Error(
        `web search timed out after ${resolved.searchTimeoutMs}ms (provider ${provider.id})`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function createAggregateProvider(
  sources: WebSearchSource[],
  strategy: WebSearchStrategy,
  defaultLimit: number,
): SearchProvider {
  const sourceIds = sources.map((source) => source.id).join('+');
  return {
    id: sources.length > 1 ? `aggregate:${sourceIds}` : (sources[0]?.id ?? 'aggregate'),
    async search(query, options) {
      const limit = options.limit > 0 ? options.limit : defaultLimit;
      if (strategy.mode === 'ordered-fallback') {
        return runOrderedFallback(sources, query, limit, strategy.perSourceTimeoutMs, options.signal);
      }
      return runParallelMerge(sources, query, limit, strategy.perSourceTimeoutMs, options.signal);
    },
  };
}

async function runParallelMerge(
  sources: WebSearchSource[],
  query: string,
  limit: number,
  perSourceTimeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<SearchHit[]> {
  const settled = await Promise.all(
    sources.map(async (source) => {
      try {
        const hits = await runSourceWithTimeout(
          source,
          query,
          limit,
          perSourceTimeoutMs,
          parentSignal,
        );
        return { sourceId: source.id, hits, error: undefined as string | undefined };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { sourceId: source.id, hits: [] as SearchHit[], error: message };
      }
    }),
  );

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

async function runOrderedFallback(
  sources: WebSearchSource[],
  query: string,
  limit: number,
  perSourceTimeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<SearchHit[]> {
  const collected: SourceHitBatch[] = [];
  const errors: string[] = [];
  for (const source of sources) {
    if (parentSignal?.aborted) {
      break;
    }
    try {
      const hits = await runSourceWithTimeout(
        source,
        query,
        limit,
        perSourceTimeoutMs,
        parentSignal,
      );
      if (hits.length > 0) {
        collected.push({ sourceId: source.id, hits });
      }
      const merged = mergeSearchHitBatches(collected, limit);
      if (merged.length >= limit) {
        return merged;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${source.id}: ${message}`);
    }
  }
  const merged = mergeSearchHitBatches(collected, limit);
  if (merged.length === 0 && errors.length > 0) {
    throw new Error(`All search sources failed. ${errors.join('; ')}`);
  }
  return merged;
}

async function runSourceWithTimeout(
  source: WebSearchSource,
  query: string,
  limit: number,
  perSourceTimeoutMs: number,
  parentSignal?: AbortSignal,
): Promise<SearchHit[]> {
  const provider = createProviderForSource(source);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), perSourceTimeoutMs);
  const signal = parentSignal
    ? anySignal([parentSignal, controller.signal])
    : controller.signal;
  try {
    return await provider.search(query, { limit, signal });
  } catch (error) {
    if (signal.aborted && !parentSignal?.aborted) {
      throw new Error(
        `source "${source.id}" timed out after ${perSourceTimeoutMs}ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveSearchSources(
  partial: Partial<WebConfig>,
  defaults: WebConfig,
): WebSearchSource[] {
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
  const mode =
    partial.mode === 'ordered-fallback' || partial.mode === 'parallel'
      ? partial.mode
      : defaults.mode;
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
  const id =
    typeof value.id === 'string' && value.id.trim()
      ? value.id.trim()
      : kind;
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
  if (typeof value.baseUrl === 'string' && value.baseUrl.trim()) {
    source.baseUrl = value.baseUrl.trim();
  }
  if (typeof value.command === 'string' && value.command.trim()) {
    source.command = value.command.trim();
  }
  if (Array.isArray(value.args)) {
    source.args = value.args.filter((item): item is string => typeof item === 'string');
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
