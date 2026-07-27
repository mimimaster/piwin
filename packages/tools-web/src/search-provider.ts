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
    fetchProvider: partial.fetchProvider ?? defaults.fetchProvider,
    fetchApiKeyEnv: partial.fetchApiKeyEnv ?? defaults.fetchApiKeyEnv,
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
          'web search disabled (web.searchProvider=none). Set duckduckgo/brave/tavily in ~/.piwin/config.json',
        );
      },
    };
  }
  if (config.searchProvider === 'duckduckgo') {
    return createDuckDuckGoProvider();
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

/**
 * Zero-config search via DuckDuckGo Instant Answer + HTML lite results.
 * No API key required. Results quality varies; still the product default.
 */
function createDuckDuckGoProvider(): SearchProvider {
  return {
    id: 'duckduckgo',
    async search(query, options) {
      const limit = Math.min(Math.max(options.limit, 1), 20);
      const hits: SearchHit[] = [];

      // Instant Answer API — free, structured, often sparse.
      try {
        const instantUrl = new URL('https://api.duckduckgo.com/');
        instantUrl.searchParams.set('q', query);
        instantUrl.searchParams.set('format', 'json');
        instantUrl.searchParams.set('no_html', '1');
        instantUrl.searchParams.set('skip_disambig', '1');
        const requestInit: RequestInit = {
          headers: { Accept: 'application/json' },
        };
        if (options.signal) {
          requestInit.signal = options.signal;
        }
        const response = await fetch(instantUrl, requestInit);
        if (response.ok) {
          const payload = (await response.json()) as {
            AbstractText?: string;
            AbstractURL?: string;
            Heading?: string;
            RelatedTopics?: Array<
              | { Text?: string; FirstURL?: string }
              | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
            >;
            Results?: Array<{ Text?: string; FirstURL?: string }>;
          };
          if (payload.AbstractURL && (payload.Heading || payload.AbstractText)) {
            hits.push({
              title: payload.Heading || payload.AbstractURL,
              url: payload.AbstractURL,
              snippet: payload.AbstractText ?? '',
              source: 'duckduckgo',
            });
          }
          const pushTopic = (topic: { Text?: string; FirstURL?: string } | undefined) => {
            if (!topic?.FirstURL || !topic.Text) {
              return;
            }
            if (hits.some((hit) => hit.url === topic.FirstURL)) {
              return;
            }
            hits.push({
              title: topic.Text.split(' - ')[0] ?? topic.Text,
              url: topic.FirstURL,
              snippet: topic.Text,
              source: 'duckduckgo',
            });
          };
          for (const topic of payload.Results ?? []) {
            pushTopic(topic);
            if (hits.length >= limit) break;
          }
          for (const topic of payload.RelatedTopics ?? []) {
            if ('Topics' in topic && Array.isArray(topic.Topics)) {
              for (const nested of topic.Topics) {
                pushTopic(nested);
                if (hits.length >= limit) break;
              }
            } else if ('FirstURL' in topic) {
              pushTopic(topic);
            }
            if (hits.length >= limit) break;
          }
        }
      } catch {
        // Fall through to HTML lite.
      }

      if (hits.length >= limit) {
        return hits.slice(0, limit);
      }

      // HTML lite page — broader organic results without a key.
      try {
        const body = new URLSearchParams({ q: query });
        const requestInit: RequestInit = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/html',
            'User-Agent': 'piwin-web-search/0.1',
          },
          body: body.toString(),
        };
        if (options.signal) {
          requestInit.signal = options.signal;
        }
        const response = await fetch('https://html.duckduckgo.com/html/', requestInit);
        if (!response.ok) {
          if (hits.length > 0) {
            return hits.slice(0, limit);
          }
          throw new Error(`DuckDuckGo HTML search failed: HTTP ${response.status}`);
        }
        const html = await response.text();
        for (const hit of parseDuckDuckGoHtmlResults(html)) {
          if (hits.some((existing) => existing.url === hit.url)) {
            continue;
          }
          hits.push(hit);
          if (hits.length >= limit) {
            break;
          }
        }
      } catch (error) {
        if (hits.length > 0) {
          return hits.slice(0, limit);
        }
        throw error;
      }

      return hits.slice(0, limit);
    },
  };
}

function parseDuckDuckGoHtmlResults(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const resultBlocks = html.split(/class="result\b/i).slice(1);
  for (const block of resultBlocks) {
    const linkMatch =
      block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) {
      continue;
    }
    const rawHref = decodeHtmlEntities(linkMatch[1] ?? '');
    const title = stripTags(decodeHtmlEntities(linkMatch[2] ?? '')).trim();
    const url = unwrapDuckDuckGoRedirect(rawHref);
    if (!url || !title || !/^https?:\/\//i.test(url)) {
      continue;
    }
    const snippetMatch =
      block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)/i) ??
      block.match(/class="result__snippet"[^>]*>([\s\S]*?)</i);
    const snippet = stripTags(decodeHtmlEntities(snippetMatch?.[1] ?? '')).trim();
    hits.push({
      title,
      url,
      snippet,
      source: 'duckduckgo',
    });
  }
  return hits;
}

function unwrapDuckDuckGoRedirect(href: string): string {
  try {
    const parsed = new URL(href, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return parsed.toString();
  } catch {
    return href;
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
