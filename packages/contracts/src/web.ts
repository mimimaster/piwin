/** Web search / fetch contracts for @piwin/tools-web */

/** Free-by-default first; API-key providers remain optional. */
export type WebSearchProvider = 'duckduckgo' | 'brave' | 'tavily' | 'none';

/**
 * How web_fetch turns a page into readable text.
 * - supermarkdown: local HTML→text/markdown-like extract (zero config)
 * - jina: r.jina.ai reader proxy (handles JS-heavy pages)
 * - firecrawl: Firecrawl scrape API (self-hostable / cloud key)
 */
export type WebFetchProvider = 'supermarkdown' | 'jina' | 'firecrawl';

export type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
};

export type WebSearchResult = {
  query: string;
  providerId: string;
  hits: SearchHit[];
};

export type WebFetchResult = {
  url: string;
  finalUrl: string;
  title: string | null;
  text: string;
  contentType: string;
  byteSize: number;
  truncated: boolean;
};

export type WebConfig = {
  searchProvider: WebSearchProvider;
  searchApiKeyEnv: string;
  searchMaxResults: number;
  /** Reader backend for HTML pages. Default: local supermarkdown. */
  fetchProvider: WebFetchProvider;
  /**
   * Env var name for fetch providers that need a key (e.g. Firecrawl).
   * Jina usually works without a key; optional `JINA_API_KEY` still accepted.
   */
  fetchApiKeyEnv: string;
  fetchMaxBytes: number;
  fetchTimeoutMs: number;
  fetchBlockedUrlPrefixes: string[];
};
