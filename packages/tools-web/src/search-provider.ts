import type { SearchHit, WebConfig, WebSearchResult } from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';

export type SearchProvider = {
  id: string;
  search(
    query: string,
    options: { limit: number; signal?: AbortSignal },
  ): Promise<SearchHit[]>;
};

export function resolveWebConfig(partial?: Partial<WebConfig> | undefined): WebConfig {
  const defaults = createDefaultWebConfig();
  if (!partial) {
    return defaults;
  }
  return {
    searchProvider: partial.searchProvider ?? defaults.searchProvider,
    searchApiKeyEnv: partial.searchApiKeyEnv ?? defaults.searchApiKeyEnv,
    searchMaxResults: partial.searchMaxResults ?? defaults.searchMaxResults,
    fetchMaxBytes: partial.fetchMaxBytes ?? defaults.fetchMaxBytes,
    fetchTimeoutMs: partial.fetchTimeoutMs ?? defaults.fetchTimeoutMs,
    fetchBlockedUrlPrefixes:
      partial.fetchBlockedUrlPrefixes ?? defaults.fetchBlockedUrlPrefixes,
  };
}

export function createSearchProvider(config: WebConfig): SearchProvider {
  if (config.searchProvider === 'none') {
    return {
      id: 'none',
      async search(): Promise<SearchHit[]> {
        throw new Error(
          'web search disabled (web.searchProvider=none). Set brave/tavily in ~/.piwin/config.json',
        );
      },
    };
  }
  if (config.searchProvider === 'tavily') {
    return createTavilyProvider(config);
  }
  return createBraveProvider(config);
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
  const searchOptions: { limit: number; signal?: AbortSignal } = {
    limit: resolved.searchMaxResults,
  };
  if (signal) {
    searchOptions.signal = signal;
  }
  const hits = await provider.search(trimmed, searchOptions);
  return {
    query: trimmed,
    providerId: provider.id,
    hits,
  };
}

function createBraveProvider(config: WebConfig): SearchProvider {
  return {
    id: 'brave',
    async search(query, options) {
      const apiKey = process.env[config.searchApiKeyEnv] ?? process.env.BRAVE_API_KEY;
      if (!apiKey) {
        throw new Error(
          `Missing API key env ${config.searchApiKeyEnv} (or BRAVE_API_KEY) for Brave Search`,
        );
      }
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(Math.max(options.limit, 1), 20)));

      const requestInit: RequestInit = {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      };
      if (options.signal) {
        requestInit.signal = options.signal;
      }
      const response = await fetch(url, requestInit);
      if (!response.ok) {
        throw new Error(`Brave search failed: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      };
      const results = payload.web?.results ?? [];
      return results
        .filter((item) => item.url && item.title)
        .map((item) => ({
          title: item.title ?? item.url ?? '',
          url: item.url ?? '',
          snippet: item.description ?? '',
          source: 'brave',
        }));
    },
  };
}

function createTavilyProvider(config: WebConfig): SearchProvider {
  return {
    id: 'tavily',
    async search(query, options) {
      const apiKey = process.env[config.searchApiKeyEnv] ?? process.env.TAVILY_API_KEY;
      if (!apiKey) {
        throw new Error(
          `Missing API key env ${config.searchApiKeyEnv} (or TAVILY_API_KEY) for Tavily`,
        );
      }
            const requestInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: Math.min(Math.max(options.limit, 1), 20),
        }),
      };
      if (options.signal) {
        requestInit.signal = options.signal;
      }
      const response = await fetch('https://api.tavily.com/search', requestInit);
      if (!response.ok) {
        throw new Error(`Tavily search failed: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      return (payload.results ?? [])
        .filter((item) => item.url && item.title)
        .map((item) => ({
          title: item.title ?? item.url ?? '',
          url: item.url ?? '',
          snippet: item.content ?? '',
          source: 'tavily',
        }));
    },
  };
}
