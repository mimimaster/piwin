import type {
  SearchChainStep,
  SearchHit,
  WebConfig,
  WebSearchDiagnostics,
  WebSearchNativeDetails,
  WebSearchProvider,
  WebSearchResult,
  WebSearchSource,
  WebSearchSourceAttempt,
  WebSearchStrategy,
} from '@piwin/contracts';
import {
  DEFAULT_FETCH_FALLBACK,
  DEFAULT_SEARCH_NATIVE_TIMEOUT_MS,
  WEB_SEARCH_SUGGESTIONS_MAX_CHARS,
  WEB_SEARCH_ATTEMPT_ERROR_MAX_CHARS,
  WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
  buildSearchChain,
  createDefaultWebConfig,
  inferSearchRoutePolicy,
} from '@piwin/contracts';
import { mergeSearchHitBatches, type SourceHitBatch } from './search-merge.js';
import { createProviderForSource, type SearchProvider } from './search-source-providers.js';
import type { WebRuntimeCredentials } from './runtime-credentials.js';
import type { WebSearchModelDelegate } from './model-search-delegate.js';

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
    searchNativeTimeoutMs:
      partial.searchNativeTimeoutMs ?? defaults.searchNativeTimeoutMs ?? DEFAULT_SEARCH_NATIVE_TIMEOUT_MS,
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
): SearchProvider {
  const resolved = resolveWebConfig(config);
  const enabled = usableSearchSources(resolved.searchSources, credentials);
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

const FREE_DUCKDUCKGO: WebSearchSource = {
  id: 'duckduckgo',
  kind: 'duckduckgo',
  enabled: true,
};

/**
 * No enabled source, or only a Devin source with no account key, is not a
 * configuration. web_search uses free DuckDuckGo. A source the user turned on
 * themselves (Brave, Tavily, CLI, HTTP) stays, even if its key is missing.
 */
function usableSearchSources(
  sources: readonly WebSearchSource[],
  credentials: WebRuntimeCredentials,
): WebSearchSource[] {
  const enabled = sources.filter((source) => source.enabled);
  const selfConfigured = enabled.filter(
    (source) => source.kind !== 'devin' && source.kind !== 'duckduckgo',
  );
  const duckduckgo = enabled.filter((source) => source.kind === 'duckduckgo');
  const devin = enabled.filter(
    (source) => source.kind === 'devin' && searchSourceHasKey(source, credentials),
  );
  if (selfConfigured.length === 0 && devin.length === 0 && duckduckgo.length === 0) {
    // Chain step `duckduckgo` injects FREE_DUCKDUCKGO via a dedicated config.
    // createSearchProvider still uses this floor so source tests stay runnable.
    return [FREE_DUCKDUCKGO];
  }
  return [...duckduckgo, ...selfConfigured, ...devin];
}

function searchSourceHasKey(source: WebSearchSource, credentials: WebRuntimeCredentials): boolean {
  if (credentials.searchApiKeysBySourceId?.[source.id]?.trim()) {
    return true;
  }
  const envName = source.apiKeyEnv?.trim();
  if (envName && process.env[envName]?.trim()) {
    return true;
  }
  if (source.kind === 'devin') {
    return Boolean(process.env.WINDSURF_API_KEY?.trim());
  }
  if (source.kind === 'brave') {
    return Boolean(process.env.BRAVE_API_KEY?.trim());
  }
  if (source.kind === 'tavily') {
    return Boolean(process.env.TAVILY_API_KEY?.trim());
  }
  return false;
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
  const chain = resolveSearchExecutionChain(resolved, delegate);
  return runSearchChain(trimmed, resolved, signal, credentials, delegate, chain);
}

/**
 * The ordered backends for one call, from the same `buildSearchChain` rule the
 * Host route preview uses. A native executor is present exactly when the Host
 * route includes the `native` step.
 */
function resolveSearchExecutionChain(
  resolved: WebConfig,
  delegate: WebSearchModelDelegate | undefined,
): SearchChainStep[] {
  const sources = resolved.searchSources;
  return buildSearchChain({
    policy: resolved.searchRoutePolicy ?? inferSearchRoutePolicy(undefined, sources),
    nativeReady: delegate !== undefined,
    hasEnabledSources: sources.some((source) => source.enabled),
    duckduckgoEnabled: sources.some((source) => source.kind === 'duckduckgo' && source.enabled),
  });
}

async function runSearchChain(
  query: string,
  resolved: WebConfig,
  signal: AbortSignal | undefined,
  credentials: WebRuntimeCredentials,
  delegate: WebSearchModelDelegate | undefined,
  chain: readonly SearchChainStep[],
): Promise<{ result: WebSearchResult; diagnostics: WebSearchDiagnostics }> {
  const startedAt = Date.now();
  const attempts: WebSearchSourceAttempt[] = [];
  let native: WebSearchNativeDetails | undefined;
  let lastError: unknown;
  for (const step of chain) {
    if (signal?.aborted) break;
    try {
      if (step === 'native') {
        if (!delegate) continue;
        const outcome = await runNativeWebSearch(query, resolved, signal, credentials, delegate);
        attempts.push(...outcome.diagnostics.attempts);
        native = outcome.diagnostics.native ?? native;
        if (outcome.diagnostics.attempts.some((attempt) => attempt.ok)) {
          return {
            result: outcome.result,
            diagnostics: {
              ...outcome.diagnostics,
              durationMs: Date.now() - startedAt,
              attempts,
              ...(native ? { native } : {}),
            },
          };
        }
        lastError = new Error('native web search returned no success');
        continue;
      }
      if (step === 'duckduckgo' && attempts.some((attempt) => attempt.sourceId === 'duckduckgo')) {
        // The sources step already fell back to DuckDuckGo; do not query it twice.
        continue;
      }
      const sourcesConfig =
        step === 'duckduckgo' ? webConfigForDuckDuckGoFloor(resolved) : resolved;
      const outcome = await runSourcesWebSearch(query, sourcesConfig, signal, credentials);
      attempts.push(...outcome.diagnostics.attempts);
      const nativeFailed = attempts.some((attempt) => attempt.sourceId.startsWith('native:') && !attempt.ok);
      return {
        result: outcome.result,
        diagnostics: {
          ...outcome.diagnostics,
          durationMs: Date.now() - startedAt,
          attempts,
          ...(native
            ? { native: nativeFailed ? { ...native, fellBackToSources: true } : native }
            : {}),
        },
      };
    } catch (error) {
      lastError = error;
      if (error instanceof WebSearchError) {
        attempts.push(...error.diagnostics.attempts);
        native = error.diagnostics.native ?? native;
      }
    }
  }
  const durationMs = Date.now() - startedAt;
  const message = describeChainFailure(attempts, lastError);
  throw new WebSearchError(
    message,
    {
      kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
      providerId: attempts[0]?.sourceId ?? 'unconfigured',
      hitCount: 0,
      durationMs,
      attempts,
      ...(native ? { native } : {}),
    },
    { cause: lastError },
  );
}

/**
 * A chain failure is only actionable if every backend's reason is visible:
 * reporting just the last step (usually the DuckDuckGo floor) hides why the
 * provider-native attempt before it failed.
 */
function describeChainFailure(attempts: readonly WebSearchSourceAttempt[], lastError: unknown): string {
  const failed = attempts.filter((attempt) => !attempt.ok && attempt.error);
  if (failed.length > 1) {
    return `Every web_search backend failed: ${failed
      .map((attempt) => `${attempt.sourceId}: ${attempt.error}`)
      .join('; ')}`;
  }
  return lastError instanceof Error ? lastError.message : 'web search exhausted every backend in the chain';
}

function webConfigForDuckDuckGoFloor(resolved: WebConfig): WebConfig {
  return {
    ...resolved,
    searchSources: [{ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }],
  };
}

/**
 * Provider-native executor (ADR 0043). On failure, `native-first` /
 * `external-first` routes run configured sources inside this same call; both
 * outcomes stay visible in `attempts`. `native-only` rethrows.
 */
async function runNativeWebSearch(
  query: string,
  resolved: WebConfig,
  signal: AbortSignal | undefined,
  credentials: WebRuntimeCredentials,
  delegate: WebSearchModelDelegate,
): Promise<{ result: WebSearchResult; diagnostics: WebSearchDiagnostics }> {
  const sourceId = `native:${delegate.model.providerId}/${delegate.model.modelId}`;
  const timeoutMs = resolved.searchNativeTimeoutMs ?? DEFAULT_SEARCH_NATIVE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const nativeSignal = signal ? anySignal([signal, controller.signal]) : controller.signal;
  const startedAt = Date.now();
  try {
    const nativeResult = await delegate.search(query, {
      limit: resolved.searchMaxResults,
      signal: nativeSignal,
    });
    if (nativeResult.hits.length === 0 && !nativeResult.answer?.trim()) {
      // Nothing usable came back: let the chain continue instead of handing
      // the model an empty "success".
      throw Object.assign(
        new Error(nativeResult.warning ?? 'native web search returned no sources and no answer'),
        { diagnostic: nativeResult.nativeDiagnostic },
      );
    }
    const durationMs = Date.now() - startedAt;
    const { searchSuggestionsHtml, nativeDiagnostic, ...modelVisible } = nativeResult;
    const native = nativeDetails(nativeDiagnostic, nativeResult.searchQueries, searchSuggestionsHtml);
    return {
      result: { ...modelVisible, query, providerId: sourceId },
      diagnostics: {
        kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
        providerId: sourceId,
        hitCount: nativeResult.hits.length,
        durationMs,
        attempts: [{ sourceId, ok: true, hitCount: nativeResult.hits.length, durationMs }],
        ...(native ? { native } : {}),
      },
    };
  } catch (error) {
    const timedOut = nativeSignal.aborted && !signal?.aborted;
    const message = timedOut
      ? `native web search timed out after ${timeoutMs}ms (${sourceId})`
      : error instanceof Error
        ? error.message
        : String(error);
    const durationMs = Date.now() - startedAt;
    const nativeAttempt: WebSearchSourceAttempt = {
      sourceId,
      ok: false,
      hitCount: 0,
      durationMs,
      ...(timedOut ? { timedOut: true } : {}),
      error: message.slice(0, WEB_SEARCH_ATTEMPT_ERROR_MAX_CHARS),
    };
    const native = nativeDetails(readErrorDiagnostic(error), undefined, undefined);
    throw new WebSearchError(
      message,
      {
        kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
        providerId: sourceId,
        hitCount: 0,
        durationMs,
        attempts: [nativeAttempt],
        ...(native ? { native } : {}),
      },
      { cause: error },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function nativeDetails(
  diagnostic: WebSearchResult['nativeDiagnostic'],
  searchQueries: string[] | undefined,
  searchSuggestionsHtml: string | undefined,
): WebSearchNativeDetails | undefined {
  if (!diagnostic) return undefined;
  return {
    diagnostic,
    ...(searchQueries && searchQueries.length > 0 ? { searchQueries } : {}),
    ...(searchSuggestionsHtml && searchSuggestionsHtml.length <= WEB_SEARCH_SUGGESTIONS_MAX_CHARS
      ? { searchSuggestionsHtml }
      : {}),
  };
}

function readErrorDiagnostic(error: unknown): WebSearchResult['nativeDiagnostic'] {
  if (typeof error !== 'object' || error === null || !('diagnostic' in error)) return undefined;
  const diagnostic = (error as { diagnostic?: unknown }).diagnostic;
  return typeof diagnostic === 'object' && diagnostic !== null
    ? (diagnostic as WebSearchResult['nativeDiagnostic'])
    : undefined;
}

async function runSourcesWebSearch(
  trimmed: string,
  resolved: WebConfig,
  signal: AbortSignal | undefined,
  credentials: WebRuntimeCredentials,
): Promise<{ result: WebSearchResult; diagnostics: WebSearchDiagnostics }> {
  let provider: SearchProvider;
  try {
    provider = createSearchProvider(resolved, credentials);
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
      // Single source: the whole call is the one attempt.
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
