/** Web search / fetch contracts for @piwin/tools-web */

import type { ModelRef } from './host.js';

/**
 * Legacy single-provider id (still written as a mirror of the multi-source list).
 * Prefer {@link WebConfig.searchSources} for configuration.
 */
export type WebSearchProvider =
  'duckduckgo' | 'brave' | 'tavily' | 'searxng' | 'cli' | 'aggregate' | 'none';

/** Built-in and user-defined search backends that tools-web can execute. */
export type WebSearchSourceKind = 'duckduckgo' | 'brave' | 'tavily' | 'searxng' | 'cli';

/** Provider kinds that support a lightweight credentials connectivity check. */
export type WebSearchTestableSourceKind = Extract<WebSearchSourceKind, 'brave' | 'tavily'>;

export type WebSearchTestInput = {
  sourceId: string;
  kind: WebSearchTestableSourceKind;
};

export type WebSearchTestResult = {
  sourceId: string;
  kind: WebSearchTestableSourceKind;
  durationMs: number;
  resultCount: number;
};

/**
 * Search scheduling mode. Multi-source search always runs every enabled source
 * in parallel and merges hits (URL-deduped). `ordered-fallback` is a legacy
 * value accepted when reading old configs; it is normalized to `parallel`.
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
  /** Keychain reference holding the API key. Raw secrets never enter config. */
  apiKeyRef?: string;
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
 * Product policy for choosing between model-native search and the Host
 * external `web_search` tool (ADR 0043). Distinct from multi-source
 * {@link WebSearchStrategy}, which only schedules external backends.
 *
 * Migration default is `external-first` so existing permission/citation
 * behavior is preserved until the user opts into native search.
 */
export type SearchRoutePolicy = 'native-first' | 'external-first' | 'native-only' | 'external-only';

/** Logical search backend selected for one generation. */
export type SearchBackend = 'native' | 'external';

/** Provenance tag for search citations rendered in the product UI. */
export type SearchCitationProvenance = 'native' | 'external';

/** Default search-route policy for new and migrated configs. */
export const DEFAULT_SEARCH_ROUTE_POLICY: SearchRoutePolicy = 'external-first';

/** Per-backend readiness facts used by the pure search-route resolver. */
export type SearchBackendReadiness = {
  ready: boolean;
  /** Model carries the `native-web-search` capability and is enabled. */
  modelTagged?: boolean;
  /** Active Pi adapter can shape provider-native search fields for this provider. */
  adapterRequestSupported?: boolean;
  /**
   * Whether native citation/grounding metadata can be normalized into product
   * events. Lack of citation support does not block request enablement, but
   * must not be reported as full native-search readiness in the UI.
   */
  adapterCitationSupported?: boolean;
  /** At least one external search source is enabled. */
  hasEnabledSources?: boolean;
  /** A configured native-search model is ready to back Host `web_search`. */
  hasDelegateModel?: boolean;
  reasons: string[];
};

export type SearchRouteReadiness = {
  native: SearchBackendReadiness;
  external: SearchBackendReadiness;
};

/**
 * Resolved single search outlet for one generation. Exactly one of
 * `selected` / neither may be set; never both backends at once.
 */
export type ResolvedSearchRoute = {
  policy: SearchRoutePolicy;
  /** Backend that will run for this generation, or null when neither is ready. */
  selected: SearchBackend | null;
  /**
   * Capability that would have been used if the first choice was unavailable
   * before the request started. Not a silent post-failure retry target.
   */
  fallback: SearchBackend | null;
  readiness: SearchRouteReadiness;
  /** Human-readable issues (missing sources, unavailable adapters, …). */
  issues: string[];
};

export type SearchRoutePreviewInput = {
  policy: SearchRoutePolicy;
  searchSources: WebSearchSource[];
  /** Draft Host `web_search` delegate; validated against configured models by Host. */
  searchDelegateModel?: ModelRef;
};

export type SearchRoutePreviewData = {
  route: ResolvedSearchRoute;
  model?: ModelRef;
  modelLabel?: string;
};

/** One normalized citation/grounding item with backend provenance. */
export type SearchCitation = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
  provenance: SearchCitationProvenance;
};

/** Product-normalized search evidence attached to assistant activity. */
export type SearchEvidence = {
  query?: string;
  provenance: SearchCitationProvenance;
  citations: SearchCitation[];
};

/**
 * Merge normalized evidence emitted by multiple stream updates. The first
 * citation for a case-insensitive URL remains authoritative so later provider
 * updates cannot replace a title, snippet, or source already shown to users.
 */
export function mergeSearchEvidence(
  existing: SearchEvidence | undefined,
  incoming: SearchEvidence,
): SearchEvidence {
  if (existing === undefined) {
    return {
      ...(incoming.query !== undefined ? { query: incoming.query } : {}),
      provenance: incoming.provenance,
      citations: [...incoming.citations],
    };
  }

  const citations = [...existing.citations];
  const seenUrls = new Set(citations.map((citation) => citation.url.trim().toLowerCase()));
  for (const citation of incoming.citations) {
    const key = citation.url.trim().toLowerCase();
    if (key.length === 0 || seenUrls.has(key)) continue;
    seenUrls.add(key);
    citations.push(citation);
  }

  return {
    ...(existing.query !== undefined
      ? { query: existing.query }
      : incoming.query !== undefined
        ? { query: incoming.query }
        : {}),
    provenance: existing.provenance,
    citations,
  };
}

/**
 * How web_fetch turns a page into readable text.
 * - supermarkdown: local HTML→text/markdown-like extract (zero config)
 * - jina: r.jina.ai reader proxy (handles JS-heavy pages)
 * - firecrawl: Firecrawl scrape API (self-hostable / cloud key)
 */
export type WebFetchProvider = 'supermarkdown' | 'jina' | 'firecrawl';

/**
 * Reader that actually produced a stored extract. `'browser'` is only a
 * fallback result (ADR 0058), not a primary Settings provider card.
 */
export type WebFetchResultProvider = WebFetchProvider | 'browser';

/**
 * Automatic retry when local extract looks JS-rendered.
 * `browser` uses an injected {@link WebPageRenderer} (ADR 0058).
 */
export type WebFetchFallback = 'none' | 'jina' | 'browser';

/** One-shot headless HTML render. Host injects this; tools-web stays pure. */
export type WebPageRenderer = {
  renderHtml: (input: {
    url: string;
    signal?: AbortSignal;
    timeoutMs: number;
  }) => Promise<{ finalUrl: string; html: string }>;
};

/** Default: do not auto-retry a thin extract. */
export const DEFAULT_FETCH_FALLBACK: WebFetchFallback = 'none';

/** How `web_fetch` chose the text returned for one call. */
export type WebFetchExtraction = 'head' | 'offset' | 'outline' | 'delegate';

/** Character window returned by one `web_fetch` view. */
export type WebFetchRange = {
  start: number;
  end: number;
};

/** Default per-call text injected into the model context. */
export const DEFAULT_FETCH_RETURN_MAX_CHARS = 18_000;
/** Default extracted text retained in FetchCache for continuation. */
export const DEFAULT_FETCH_STORE_MAX_CHARS = 200_000;
/** Default FetchCache TTL. */
export const DEFAULT_FETCH_CACHE_TTL_MS = 900_000;
/** FetchCache LRU byte budget (extracted text, not raw HTML). */
export const DEFAULT_FETCH_CACHE_MAX_BYTES = 24 * 1024 * 1024;
/** Heading outline cap attached to a fetch result. */
export const MAX_FETCH_OUTLINE_ITEMS = 60;
/** Stored text passed into the focused-extract delegate. */
export const DEFAULT_FETCH_DELEGATE_INPUT_CHARS = 150_000;
/** Focused excerpt returned when `web_fetch` is called with `query`. */
export const DEFAULT_FETCH_DELEGATE_OUTPUT_CHARS = 4_000;

/** Page text + question handed to a configured fetch-extract model. */
export type WebFetchExtractInput = {
  query: string;
  url: string;
  title: string | null;
  text: string;
};

/**
 * Host-injected port: a small model extracts query-relevant passages from a
 * cached page. tools-web must not call providers directly.
 */
export type WebFetchExtractDelegate = {
  model: ModelRef;
  extract: (
    input: WebFetchExtractInput,
    options?: { signal?: AbortSignal },
  ) => Promise<string>;
};

/** Host-injected PDF / document text extract. tools-web must not import media. */
export type WebDocumentExtractor = {
  extract: (input: {
    bytes: Uint8Array;
    mimeType: string;
    url: string;
    maxChars: number;
    signal?: AbortSignal;
  }) => Promise<{ text: string; title: string | null; pageCount?: number }>;
};

/** Host-injected write of the full extracted text for grep / read_file. */
export type WebFetchSpillStore = {
  write: (input: { url: string; text: string }) => Promise<string>;
};

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

export type WebFetchTruncationReason = 'response-limit' | 'parse-limit' | 'text-limit';

export type WebFetchResult = {
  url: string;
  finalUrl: string;
  title: string | null;
  text: string;
  contentType: string;
  /** Bytes retained/read; when truncated this is the bounded prefix size. */
  byteSize: number;
  truncated: boolean;
  truncationReason?: WebFetchTruncationReason;
  /** Extracted text length retained in cache (may exceed `text`). */
  totalChars?: number;
  /** Character window of `text` inside the cached extraction. */
  range?: WebFetchRange;
  /** Cached extraction has text after `range.end`. */
  hasMore?: boolean;
  /** `offset` to pass on the next call to continue reading. */
  nextOffset?: number;
  /** Flattened h1–h6 / markdown headings, capped at {@link MAX_FETCH_OUTLINE_ITEMS}. */
  outline?: string[];
  /** True when this call reused a cached extraction (permission still ran). */
  fromCache?: boolean;
  /** Reader backend that produced the cached extraction. */
  provider?: WebFetchResultProvider;
  extraction?: WebFetchExtraction;
  /** Suspected JS-rendered page: extracted text is thin relative to HTML. */
  thinContent?: boolean;
  /** Absolute path of the full extracted text when it exceeded this call's window. */
  spillPath?: string;
  /** PDF page count when the extract came from a document extractor. */
  pageCount?: number;
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
  /**
   * Optional configured model used as the exclusive backend for Host
   * `web_search`. The model must be enabled and tagged `native-web-search`.
   * Ordinary search sources remain configured but are not called while this
   * delegate is selected.
   */
  searchDelegateModel?: ModelRef;
  /**
   * Optional chat model used to extract a query-focused excerpt from a
   * cached `web_fetch` page. Missing or failed extraction falls back to the
   * mechanical head window.
   */
  fetchDelegateModel?: ModelRef;
  /**
   * When local `supermarkdown` extract is thin, retry once with this backend.
   * Default {@link DEFAULT_FETCH_FALLBACK}.
   */
  fetchFallback?: WebFetchFallback;
  /** Merge / run strategy for multi-source search. */
  searchStrategy: WebSearchStrategy;
  /**
   * Native vs external search outlet policy (ADR 0043).
   * Default / migration value: {@link DEFAULT_SEARCH_ROUTE_POLICY}.
   */
  searchRoutePolicy: SearchRoutePolicy;
  /** Reader backend for HTML pages. Default: local supermarkdown. */
  fetchProvider: WebFetchProvider;
  /** Keychain reference for the selected fetch provider. */
  fetchApiKeyRef?: string;
  /**
   * Env var name for fetch providers that need a key (e.g. Firecrawl).
   * Jina usually works without a key; optional `JINA_API_KEY` still accepted.
   */
  fetchApiKeyEnv: string;
  fetchMaxBytes: number;
  /**
   * Per-call text returned to the model. When omitted, equals the store cap
   * (legacy: {@link fetchMaxBytes}).
   */
  fetchReturnMaxChars?: number;
  /**
   * Extracted text retained for offset / outline continuation. When set,
   * transport uses a 1 MiB body cap and a 512 KiB parse cap. When omitted,
   * store/body/parse caps derive from {@link fetchMaxBytes} (legacy).
   */
  fetchStoreMaxChars?: number;
  /** FetchCache TTL in ms. Default {@link DEFAULT_FETCH_CACHE_TTL_MS}. */
  fetchCacheTtlMs?: number;
  fetchTimeoutMs: number;
  fetchBlockedUrlPrefixes: string[];
};
