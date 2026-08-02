/** Web search / fetch contracts for @piwin/tools-web */

/**
 * Legacy single-provider id (still written as a mirror of the multi-source list).
 * Prefer {@link WebConfig.searchSources} for configuration.
 */
export type WebSearchProvider =
  | 'duckduckgo'
  | 'brave'
  | 'tavily'
  | 'searxng'
  | 'cli'
  | 'aggregate'
  | 'none';

/** Built-in and user-defined search backends that tools-web can execute. */
export type WebSearchSourceKind = 'duckduckgo' | 'brave' | 'tavily' | 'searxng' | 'cli';

/**
 * How tools-web runs multiple enabled sources for one `web_search` call.
 * - parallel: all enabled sources at once, then host-side merge (default)
 * - ordered-fallback: try in list order until maxResults is reached
 */
export type WebSearchStrategyMode = 'parallel' | 'ordered-fallback';

/**
 * One configured search source. Model still sees a single `web_search` tool;
 * host runs enabled sources and merges hits.
 */
export type WebSearchSource = {
  /** Stable id within the list (used for UI keys and hit source tags). */
  id: string;
  kind: WebSearchSourceKind;
  enabled: boolean;
  /** Optional display label in Settings. */
  label?: string;
  /**
   * Env var name holding the API key (brave / tavily).
   * Secrets stay out of config files.
   */
  apiKeyEnv?: string;
  /** SearXNG instance base URL (e.g. https://searx.example.com). */
  baseUrl?: string;
  /**
   * Executable for kind=cli (no shell). Args come from {@link args};
   * use `{{query}}` as a placeholder token.
   */
  command?: string;
  /** CLI argv template; `{{query}}` is replaced with the search query. */
  args?: string[];
};

export type WebSearchStrategy = {
  mode: WebSearchStrategyMode;
  /** Hard timeout per source (ms). Default 8000. */
  perSourceTimeoutMs: number;
};

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
  /**
   * Set when the provider returned successfully but produced no hits, so the
   * model does not mistake "searched, nothing found" for a silent failure.
   */
  warning?: string;
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
  /**
   * Legacy mirror of the multi-source list (single / aggregate / none).
   * Prefer {@link searchSources}; loaders migrate old configs into sources.
   */
  searchProvider: WebSearchProvider;
  /** Legacy single API-key env; used when migrating brave/tavily-only configs. */
  searchApiKeyEnv: string;
  searchMaxResults: number;
  /** Hard timeout for the whole web_search call, in ms. Default 15000. */
  searchTimeoutMs: number;
  /**
   * Multi-source list. Empty or all-disabled means web_search is off.
   * When omitted on load, host migrates from {@link searchProvider}.
   */
  searchSources: WebSearchSource[];
  /** Merge / run strategy for multi-source search. */
  searchStrategy: WebSearchStrategy;
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
