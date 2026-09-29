/** Web search / fetch contracts for @piwin/tools-web */

import type { ModelRef } from './host.js';
import type { NativeSearchAdapterKind } from './config.js';

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
  | 'http'
  | 'devin'
  | 'aggregate'
  | 'none';

const WEB_SEARCH_SOURCE_KINDS = [
  'duckduckgo',
  'brave',
  'tavily',
  'searxng',
  'cli',
  'http',
  'devin',
] as const;

/** Built-in and user-defined search backends that tools-web can execute. */
export type WebSearchSourceKind = (typeof WEB_SEARCH_SOURCE_KINDS)[number];

export function isWebSearchSourceKind(value: unknown): value is WebSearchSourceKind {
  return (
    typeof value === 'string' && (WEB_SEARCH_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

/** Custom CLI settings card covers both local spawn and HTTP adapters. */
export function isCustomWebSearchKind(
  kind: WebSearchSourceKind,
): kind is Extract<WebSearchSourceKind, 'cli' | 'http'> {
  return kind === 'cli' || kind === 'http';
}

/** Provider kinds that support a lightweight connectivity check from Settings. */
export type WebSearchTestableSourceKind = Extract<
  WebSearchSourceKind,
  'brave' | 'tavily' | 'searxng' | 'cli' | 'http' | 'devin'
>;

export type WebSearchTestInput = {
  sourceId: string;
  kind: WebSearchTestableSourceKind;
  /**
   * Unsaved draft. When set, Host tests this snapshot instead of the stored
   * source so Settings can verify CLI/HTTP/SearXNG before Save.
   */
  source?: WebSearchSource;
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
  /** SearXNG instance or custom HTTP search URL (kind=http). */
  baseUrl?: string;
  /**
   * Executable for kind=cli (no shell). Args come from {@link args};
   * use `{{query}}` as a placeholder token.
   */
  command?: string;
  /** CLI argv template; `{{query}}` is replaced with the search query. */
  args?: string[];
  /**
   * Extra env for kind=cli. Merged over the Host process env at spawn.
   * Do not put secrets here when a keychain ref is available.
   */
  env?: Record<string, string>;
};

export type WebSearchStrategy = {
  mode: WebSearchStrategyMode;
  /** Hard timeout per source (ms). Default 8000. */
  perSourceTimeoutMs: number;
};

/**
 * Product policy for the ordered `web_search` chain (ADR 0043). Distinct from
 * multi-source {@link WebSearchStrategy}, which only schedules the `sources`
 * step in parallel.
 *
 * Packing default is `native-first` with no external sources enabled.
 * A saved config that already has enabled sources but omitted this field
 * keeps `external-first` so user setup is not rewritten at load time.
 */
export type SearchRoutePolicy = 'native-first' | 'external-first' | 'native-only' | 'external-only';

/**
 * One step in a single `web_search` call.
 * - `native` — provider-native sub-request on the tagged model / delegate.
 * - `sources` — user-enabled configured sources, merged in parallel.
 * - `duckduckgo` — free floor, used when sources are off or after they fail.
 */
export type SearchChainStep = 'native' | 'sources' | 'duckduckgo';

/** Provenance tag for search citations rendered in the product UI. */
export type SearchCitationProvenance = 'native' | 'external';

/** Packing default: model built-in search first, DuckDuckGo as floor. */
export const DEFAULT_SEARCH_ROUTE_POLICY: SearchRoutePolicy = 'native-first';

export function isSearchRoutePolicy(value: unknown): value is SearchRoutePolicy {
  return (
    value === 'native-first' ||
    value === 'external-first' ||
    value === 'native-only' ||
    value === 'external-only'
  );
}

/**
 * Resolve a stored or omitted search-route policy.
 * Enabled external sources without an explicit policy stay `external-first`.
 */
export function inferSearchRoutePolicy(
  policy: unknown,
  sources: readonly Pick<WebSearchSource, 'enabled'>[] = [],
): SearchRoutePolicy {
  if (isSearchRoutePolicy(policy)) {
    return policy;
  }
  if (sources.some((source) => source.enabled)) {
    return 'external-first';
  }
  return DEFAULT_SEARCH_ROUTE_POLICY;
}

/**
 * Build the ordered backends for one `web_search` call.
 * DuckDuckGo is appended as a floor unless the user already enabled it inside
 * `sources`, or the policy is `native-only`.
 */
export function buildSearchChain(input: {
  policy: SearchRoutePolicy;
  nativeReady: boolean;
  hasEnabledSources: boolean;
  duckduckgoEnabled?: boolean;
}): SearchChainStep[] {
  const includeNative = input.nativeReady && input.policy !== 'external-only';
  const includeSources = input.hasEnabledSources && input.policy !== 'native-only';
  const includeDuckduckgo =
    input.policy !== 'native-only' && (input.duckduckgoEnabled !== true || !includeSources);
  const steps: SearchChainStep[] = [];
  const push = (step: SearchChainStep, include: boolean): void => {
    if (include && !steps.includes(step)) steps.push(step);
  };
  switch (input.policy) {
    case 'native-first':
    case 'native-only':
      push('native', includeNative);
      push('sources', includeSources);
      push('duckduckgo', includeDuckduckgo);
      break;
    case 'external-first':
    case 'external-only':
      push('sources', includeSources);
      push('native', includeNative);
      push('duckduckgo', includeDuckduckgo);
      break;
  }
  return steps;
}

/** Per-backend readiness facts used by the pure search-route resolver. */
export type SearchBackendReadiness = {
  ready: boolean;
  /** Model carries the `native-web-search` capability and is enabled. */
  modelTagged?: boolean;
  /** Declared or inferred adapter can be expressed for this provider. */
  adapterRequestSupported?: boolean;
  /** At least one user-enabled external search source. */
  hasEnabledSources?: boolean;
  /**
   * A configured native-search delegate model is ready to back Host
   * `web_search`. This is native readiness: the delegate is a provider-native
   * executor for the Host tool, not an external source.
   */
  hasDelegateModel?: boolean;
  reasons: string[];
};

export type SearchRouteReadiness = {
  native: SearchBackendReadiness;
  external: SearchBackendReadiness;
};

/**
 * Resolved `web_search` chain for one generation. `chain` is the only source
 * of truth: Settings display it, the Host tool executes it, the log records
 * one attempt per step.
 */
export type ResolvedSearchRoute = {
  policy: SearchRoutePolicy;
  /** Ordered backends tried inside one `web_search` call; first success wins. */
  chain: SearchChainStep[];
  readiness: SearchRouteReadiness;
  /** Human-readable issues (unavailable adapters, empty native-only, …). */
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

/**
 * Message-level search evidence. Read-only legacy: assistant messages from
 * the retired main-session native search (v0.1.0) still carry it. Nothing
 * produces it anymore; live native-search citations ride the `web_search`
 * tool card (`WebSearchResult`).
 */
export type SearchEvidence = {
  query?: string;
  provenance: SearchCitationProvenance;
  citations: SearchCitation[];
  /** Bounded provider-native execution facts; never contains query, prompt, headers, or bodies. */
  nativeDiagnostic?: NativeSearchDiagnostic;
};

/**
 * How a provider-native search sub-request was executed.
 * - `pi-tee`: official Pi `streamSimple` with a response-body tee on `fetch`.
 * - `gemini-rest`: direct non-streaming Gemini `generateContent` REST call
 *   (Pi's Google adapter rejects custom fetch, so grounding is unobservable there).
 */
export type NativeSearchTransport = 'pi-tee' | 'gemini-rest';

/** Bound on persisted native-search error text; full errors stay in Host logs. */
export const NATIVE_SEARCH_ERROR_MAX_CHARS = 300;

/**
 * Safe provider-native search telemetry persisted with evidence/tool cards.
 * Never contains query, prompt, headers, request/response bodies, or credentials.
 */
export type NativeSearchDiagnostic = {
  providerId: string;
  adapter: NativeSearchAdapterKind;
  /** Optional for transcripts persisted before the Host-tool executor existed. */
  transport?: NativeSearchTransport;
  /** A provider search/grounding event was observed in the raw response. */
  eventDetected: boolean;
  hitCount: number;
  durationMs: number;
  /** Bounded failure text ({@link NATIVE_SEARCH_ERROR_MAX_CHARS}). */
  error?: string;
};

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

/** One provider-reported citation span backing a native grounded answer. */
export type WebSearchCitation = {
  url: string;
  title?: string;
  /** Provider-supplied cited text; never synthesized from model prose. */
  citedText?: string;
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
  /** Native executors only: bounded grounded brief written by the search model. */
  answer?: string;
  /** Native executors only: queries the provider actually issued. */
  searchQueries?: string[];
  /** Native executors only: provider citation annotations/supports. */
  citations?: WebSearchCitation[];
  /**
   * Gemini only: `searchEntryPoint.renderedContent`, kept verbatim because
   * Google's grounding terms require showing Search Suggestions unmodified.
   * Untrusted HTML — render only inside a script-free sandbox.
   */
  searchSuggestionsHtml?: string;
  /** Native executors only: bounded execution telemetry. */
  nativeDiagnostic?: NativeSearchDiagnostic;
};

/** `ToolResult.details.kind` for `web_search` diagnostics. */
export const WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND = 'web-search-diagnostics';

/** Bound on persisted per-source error text; full errors stay in Host logs. */
export const WEB_SEARCH_ATTEMPT_ERROR_MAX_CHARS = 300;

/** One source's outcome inside a single `web_search` call. */
export type WebSearchSourceAttempt = {
  sourceId: string;
  ok: boolean;
  /** Raw hits this source returned, before cross-source URL dedupe. */
  hitCount: number;
  durationMs: number;
  timedOut?: boolean;
  error?: string;
};

/**
 * Structured diagnostics for one `web_search` call. Carried in
 * `ToolResult.details` (never the model-visible output) so the product UI can
 * show which sources failed or were slow even when the merged result succeeded.
 */
export type WebSearchDiagnostics = {
  kind: typeof WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND;
  providerId: string;
  /** Hits returned to the model after merge/dedupe. */
  hitCount: number;
  durationMs: number;
  attempts: WebSearchSourceAttempt[];
  /** Present when a provider-native executor ran (even if it then fell back). */
  native?: WebSearchNativeDetails;
};

/** Native-executor facts kept out of the model-visible tool output. */
export type WebSearchNativeDetails = {
  diagnostic: NativeSearchDiagnostic;
  /** Queries the provider actually issued. */
  searchQueries?: string[];
  /** Gemini Search Suggestions, verbatim untrusted HTML (sandbox only). */
  searchSuggestionsHtml?: string;
  /** True when the native attempt failed and configured sources answered instead. */
  fellBackToSources?: boolean;
};

/** Bound on persisted Search Suggestions HTML. */
export const WEB_SEARCH_SUGGESTIONS_MAX_CHARS = 64_000;

export function readWebSearchDiagnostics(details: unknown): WebSearchDiagnostics | null {
  if (typeof details !== 'object' || details === null) {
    return null;
  }
  const candidate = details as Partial<WebSearchDiagnostics>;
  if (
    candidate.kind !== WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND ||
    typeof candidate.providerId !== 'string' ||
    !Array.isArray(candidate.attempts)
  ) {
    return null;
  }
  const attempts: WebSearchSourceAttempt[] = [];
  for (const raw of candidate.attempts) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Partial<WebSearchSourceAttempt>;
    if (typeof item.sourceId !== 'string' || typeof item.ok !== 'boolean') continue;
    const attempt: WebSearchSourceAttempt = {
      sourceId: item.sourceId,
      ok: item.ok,
      hitCount: finiteNonNegative(item.hitCount),
      durationMs: finiteNonNegative(item.durationMs),
    };
    if (item.timedOut === true) attempt.timedOut = true;
    if (typeof item.error === 'string' && item.error.length > 0) {
      attempt.error = item.error.slice(0, WEB_SEARCH_ATTEMPT_ERROR_MAX_CHARS);
    }
    attempts.push(attempt);
  }
  const native = readWebSearchNativeDetails(candidate.native);
  return {
    kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
    providerId: candidate.providerId,
    hitCount: finiteNonNegative(candidate.hitCount),
    durationMs: finiteNonNegative(candidate.durationMs),
    attempts,
    ...(native ? { native } : {}),
  };
}

function readWebSearchNativeDetails(value: unknown): WebSearchNativeDetails | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const candidate = value as Partial<WebSearchNativeDetails>;
  const raw = candidate.diagnostic as Partial<NativeSearchDiagnostic> | undefined;
  if (
    typeof raw !== 'object' ||
    raw === null ||
    typeof raw.providerId !== 'string' ||
    typeof raw.adapter !== 'string'
  ) {
    return undefined;
  }
  const diagnostic: NativeSearchDiagnostic = {
    providerId: raw.providerId,
    adapter: raw.adapter,
    ...(raw.transport === 'pi-tee' || raw.transport === 'gemini-rest' ? { transport: raw.transport } : {}),
    eventDetected: raw.eventDetected === true,
    hitCount: finiteNonNegative(raw.hitCount),
    durationMs: finiteNonNegative(raw.durationMs),
    ...(typeof raw.error === 'string' && raw.error.length > 0
      ? { error: raw.error.slice(0, NATIVE_SEARCH_ERROR_MAX_CHARS) }
      : {}),
  };
  const searchQueries = Array.isArray(candidate.searchQueries)
    ? candidate.searchQueries.filter((query): query is string => typeof query === 'string').slice(0, 20)
    : [];
  const html =
    typeof candidate.searchSuggestionsHtml === 'string' &&
    candidate.searchSuggestionsHtml.length > 0 &&
    candidate.searchSuggestionsHtml.length <= WEB_SEARCH_SUGGESTIONS_MAX_CHARS
      ? candidate.searchSuggestionsHtml
      : undefined;
  return {
    diagnostic,
    ...(searchQueries.length > 0 ? { searchQueries } : {}),
    ...(html ? { searchSuggestionsHtml: html } : {}),
    ...(candidate.fellBackToSources === true ? { fellBackToSources: true } : {}),
  };
}

/** Bound on the persisted query text of one search log row. */
export const WEB_SEARCH_LOG_QUERY_MAX_CHARS = 500;

/**
 * Provider-native facts kept on a search log row (ADR 0043). Safe telemetry
 * only: no suggestions HTML, headers, bodies, or the issued query texts (the
 * row already stores the user query; issued queries stay on the tool card).
 */
export type WebSearchLogNativeSummary = {
  providerId: string;
  adapter: NativeSearchAdapterKind;
  transport?: NativeSearchTransport;
  /** A provider search/grounding event was observed in the raw response. */
  eventDetected: boolean;
  /** How many queries the provider actually issued. */
  searchQueryCount: number;
  /** The native attempt failed and configured sources answered instead. */
  fellBackToSources?: boolean;
  /** Bounded native failure text. */
  error?: string;
};

/** One `web_search` call as the Host observed it, success or failure. */
export type WebSearchLogRecord = {
  sessionId: string;
  query: string;
  ok: boolean;
  providerId: string;
  hitCount: number;
  durationMs: number;
  attempts: WebSearchSourceAttempt[];
  /** Top-level failure message when `ok` is false. */
  error?: string;
  /** Present when the provider-native executor ran for this call. */
  native?: WebSearchLogNativeSummary;
};

/** Project tool-card native details down to the loggable summary. */
export function summarizeWebSearchNativeForLog(
  native: WebSearchNativeDetails | undefined,
): WebSearchLogNativeSummary | undefined {
  if (!native) return undefined;
  const { diagnostic } = native;
  return {
    providerId: diagnostic.providerId,
    adapter: diagnostic.adapter,
    ...(diagnostic.transport ? { transport: diagnostic.transport } : {}),
    eventDetected: diagnostic.eventDetected,
    searchQueryCount: native.searchQueries?.length ?? 0,
    ...(native.fellBackToSources ? { fellBackToSources: true } : {}),
    ...(diagnostic.error ? { error: diagnostic.error.slice(0, NATIVE_SEARCH_ERROR_MAX_CHARS) } : {}),
  };
}

/** Validate a persisted/remote native summary; unknown shapes are dropped. */
export function readWebSearchLogNativeSummary(value: unknown): WebSearchLogNativeSummary | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Partial<WebSearchLogNativeSummary>;
  if (typeof raw.providerId !== 'string' || typeof raw.adapter !== 'string') return undefined;
  return {
    providerId: raw.providerId,
    adapter: raw.adapter,
    ...(raw.transport === 'pi-tee' || raw.transport === 'gemini-rest' ? { transport: raw.transport } : {}),
    eventDetected: raw.eventDetected === true,
    searchQueryCount: Math.min(20, Math.floor(finiteNonNegative(raw.searchQueryCount))),
    ...(raw.fellBackToSources === true ? { fellBackToSources: true } : {}),
    ...(typeof raw.error === 'string' && raw.error.length > 0
      ? { error: raw.error.slice(0, NATIVE_SEARCH_ERROR_MAX_CHARS) }
      : {}),
  };
}

/** Host-injected sink for the cross-session search call log. Must not throw. */
export type WebSearchLogSink = {
  record: (record: WebSearchLogRecord) => void;
};

/** One row of the search call log (`web/search-log-list`), newest first. */
export type WebSearchLogEntry = WebSearchLogRecord & {
  id: string;
  recordedAt: string;
};

export type WebSearchLogStatusFilter = 'all' | 'failed';

/** One page of `web/search-log-list`. */
export type WebSearchLogPage = {
  entries: WebSearchLogEntry[];
  /** Rows matching the filter, across all pages. */
  total: number;
  offset: number;
  limit: number;
};

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

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

/** Default budget for one provider-native search sub-request. */
export const DEFAULT_SEARCH_NATIVE_TIMEOUT_MS = 120_000;

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
   * Timeout for one provider-native search sub-request, in ms. Native
   * searches run a full model turn, so this is separate from
   * {@link searchTimeoutMs}. Default {@link DEFAULT_SEARCH_NATIVE_TIMEOUT_MS}.
   */
  searchNativeTimeoutMs?: number;
  /**
   * Multi-source list. Empty or all-disabled means web_search is off.
   * When omitted on load, host migrates from {@link searchProvider}.
   */
  searchSources: WebSearchSource[];
  /**
   * Optional configured model used as the native executor for Host
   * `web_search`. The model must be enabled and tagged `native-web-search`.
   * Configured sources remain later steps in the same call unless the policy
   * is `native-only`.
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
   * Packing default: {@link DEFAULT_SEARCH_ROUTE_POLICY}. Omitted values on
   * configs that already have enabled sources infer `external-first`.
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

/**
 * Devin OAuth logout turns off the Devin search switch. If that was the only
 * enabled source, free DuckDuckGo turns on.
 */
export function planDevinLogoutSearch(
  sources: readonly { kind: string; enabled: boolean }[],
): { disableDevin: true; enableDuckDuckGo: boolean } | undefined {
  if (!sources.some((source) => source.kind === 'devin' && source.enabled)) {
    return undefined;
  }
  const otherEnabled = sources.some((source) => source.enabled && source.kind !== 'devin');
  return { disableDevin: true, enableDuckDuckGo: !otherEnabled };
}
