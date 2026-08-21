/**
 * Pure draft<->config conversion for the Web tools settings form.
 * Draft keeps raw strings so users can type freely; parsing happens on save.
 */
import {
  DEFAULT_FETCH_CACHE_TTL_MS,
  DEFAULT_FETCH_RETURN_MAX_CHARS,
  DEFAULT_FETCH_STORE_MAX_CHARS,
  DEFAULT_SEARCH_ROUTE_POLICY,
  type ModelRef,
  type SearchRoutePolicy,
  type WebConfig,
  type WebFetchFallback,
  type WebSearchSource,
  type WebSearchSourceKind,
} from '@piwin/contracts';

export type DraftSearchSource = {
  id: string;
  kind: WebSearchSourceKind;
  enabled: boolean;
  label: string;
  apiKeyEnv: string;
  apiKeyRef: string;
  baseUrl: string;
  command: string;
  /** One argv token per line; use {{query}} for the search query token. */
  args: string;
};

export type DraftWeb = {
  searchSources: DraftSearchSource[];
  searchDelegateModel?: ModelRef;
  fetchDelegateModel?: ModelRef;
  searchRoutePolicy: SearchRoutePolicy;
  perSourceTimeoutMs: string;
  searchMaxResults: string;
  searchTimeoutMs: string;
  fetchProvider: WebConfig['fetchProvider'];
  fetchApiKeyRef: string;
  fetchApiKeyEnv: string;
  fetchMaxBytes: string;
  fetchReturnMaxChars: string;
  fetchStoreMaxChars: string;
  fetchCacheTtlMs: string;
  fetchFallback: WebFetchFallback;
  fetchTimeoutMs: string;
  fetchBlockedUrlPrefixes: string;
};

export function webToDraft(web: WebConfig): DraftWeb {
  return {
    searchSources: (web.searchSources ?? []).map(sourceToDraft),
    ...(web.searchDelegateModel ? { searchDelegateModel: web.searchDelegateModel } : {}),
    ...(web.fetchDelegateModel ? { fetchDelegateModel: web.fetchDelegateModel } : {}),
    searchRoutePolicy: web.searchRoutePolicy ?? DEFAULT_SEARCH_ROUTE_POLICY,
    perSourceTimeoutMs: String(web.searchStrategy?.perSourceTimeoutMs ?? 8000),
    searchMaxResults: String(web.searchMaxResults ?? 10),
    searchTimeoutMs: String(web.searchTimeoutMs ?? 15000),
    fetchProvider: web.fetchProvider ?? 'supermarkdown',
    fetchApiKeyRef: web.fetchApiKeyRef ?? '',
    fetchApiKeyEnv: web.fetchApiKeyEnv ?? '',
    fetchMaxBytes: String(web.fetchMaxBytes ?? 65536),
    fetchReturnMaxChars: String(web.fetchReturnMaxChars ?? DEFAULT_FETCH_RETURN_MAX_CHARS),
    fetchStoreMaxChars: String(web.fetchStoreMaxChars ?? DEFAULT_FETCH_STORE_MAX_CHARS),
    fetchCacheTtlMs: String(web.fetchCacheTtlMs ?? DEFAULT_FETCH_CACHE_TTL_MS),
    fetchFallback: web.fetchFallback ?? 'none',
    fetchTimeoutMs: String(web.fetchTimeoutMs ?? 15000),
    fetchBlockedUrlPrefixes: (web.fetchBlockedUrlPrefixes ?? []).join(', '),
  };
}

/** Remote Settings strips `command`; keep the Host CLI path if the draft omitted it. */
export function preserveWebCliLaunchers(next: WebConfig, previous?: WebConfig): WebConfig {
  if (!previous) {
    return next;
  }
  const previousById = new Map(previous.searchSources.map((source) => [source.id, source]));
  return {
    ...next,
    searchSources: next.searchSources.map((source) => {
      if (source.kind !== 'cli') {
        return source;
      }
      const prior =
        previousById.get(source.id) ??
        previous.searchSources.find((candidate) => candidate.kind === 'cli');
      if (!prior) {
        return source;
      }
      const command = source.command?.trim() || prior.command;
      const args = source.args && source.args.length > 0 ? source.args : prior.args;
      return {
        ...source,
        ...(command ? { command } : {}),
        ...(args && args.length > 0 ? { args } : {}),
      };
    }),
  };
}

export function draftToWeb(draft: DraftWeb): WebConfig {
  const maxResults = Number(draft.searchMaxResults);
  const maxBytes = Number(draft.fetchMaxBytes);
  const timeoutMs = Number(draft.fetchTimeoutMs);
  const searchTimeoutMs = Number(draft.searchTimeoutMs);
  const perSourceTimeoutMs = Number(draft.perSourceTimeoutMs);
  const searchSources = draft.searchSources.map(draftSourceToConfig);
  const enabled = searchSources.filter((source) => source.enabled);
  let searchProvider: WebConfig['searchProvider'] = 'none';
  if (enabled.length === 1) {
    searchProvider = enabled[0]?.kind ?? 'none';
  } else if (enabled.length > 1) {
    searchProvider = 'aggregate';
  }
  const firstKey =
    enabled.find((source) => source.apiKeyEnv)?.apiKeyEnv ??
    searchSources.find((source) => source.apiKeyEnv)?.apiKeyEnv ??
    '';
  const fetchReturnMaxChars =
    positiveInt(draft.fetchReturnMaxChars) ?? DEFAULT_FETCH_RETURN_MAX_CHARS;
  const fetchStoreMaxChars =
    positiveInt(draft.fetchStoreMaxChars) ?? DEFAULT_FETCH_STORE_MAX_CHARS;
  const fetchCacheTtlMs = positiveInt(draft.fetchCacheTtlMs) ?? DEFAULT_FETCH_CACHE_TTL_MS;
  return {
    searchProvider,
    searchApiKeyEnv: firstKey,
    searchRoutePolicy: draft.searchRoutePolicy,
    searchMaxResults: Number.isFinite(maxResults) && maxResults > 0 ? Math.floor(maxResults) : 10,
    searchTimeoutMs:
      Number.isFinite(searchTimeoutMs) && searchTimeoutMs > 0 ? Math.floor(searchTimeoutMs) : 15000,
    searchSources,
    ...(draft.searchDelegateModel ? { searchDelegateModel: draft.searchDelegateModel } : {}),
    ...(draft.fetchDelegateModel ? { fetchDelegateModel: draft.fetchDelegateModel } : {}),
    searchStrategy: {
      // Multi-source search is always parallel (aggregate + URL dedupe).
      mode: 'parallel',
      perSourceTimeoutMs:
        Number.isFinite(perSourceTimeoutMs) && perSourceTimeoutMs > 0
          ? Math.floor(perSourceTimeoutMs)
          : 8000,
    },
    fetchProvider: draft.fetchProvider,
    fetchFallback: draft.fetchFallback,
    ...(draft.fetchApiKeyRef?.trim() ? { fetchApiKeyRef: draft.fetchApiKeyRef.trim() } : {}),
    fetchApiKeyEnv: draft.fetchApiKeyEnv?.trim() || 'FIRECRAWL_API_KEY',
    fetchMaxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 65536,
    fetchReturnMaxChars,
    fetchStoreMaxChars,
    fetchCacheTtlMs,
    fetchTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 15000,
    fetchBlockedUrlPrefixes: (draft.fetchBlockedUrlPrefixes ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  };
}

export function createDraftSearchSource(
  kind: WebSearchSourceKind,
  existingIds: readonly string[],
): DraftSearchSource {
  const id = uniqueSourceId(kind, existingIds);
  const base: DraftSearchSource = {
    id,
    kind,
    enabled: true,
    label: '',
    apiKeyEnv: '',
    apiKeyRef: '',
    baseUrl: '',
    command: '',
    args: '',
  };
  if (kind === 'brave') {
    base.apiKeyEnv = 'BRAVE_API_KEY';
  } else if (kind === 'tavily') {
    base.apiKeyEnv = 'TAVILY_API_KEY';
  } else if (kind === 'searxng') {
    base.baseUrl = 'http://127.0.0.1:8080';
  } else if (kind === 'cli') {
    base.command = '';
    base.args = '{{query}}';
  }
  return base;
}

function sourceToDraft(source: WebSearchSource): DraftSearchSource {
  return {
    id: source.id,
    kind: source.kind,
    enabled: source.enabled,
    label: source.label ?? '',
    apiKeyEnv: source.apiKeyEnv ?? '',
    apiKeyRef: source.apiKeyRef ?? '',
    baseUrl: source.baseUrl ?? '',
    command: source.command ?? '',
    args: (source.args ?? []).join('\n'),
  };
}

function draftSourceToConfig(draft: DraftSearchSource): WebSearchSource {
  const source: WebSearchSource = {
    id: draft.id?.trim() || draft.kind,
    kind: draft.kind,
    enabled: draft.enabled,
  };
  if (draft.label?.trim()) {
    source.label = draft.label.trim();
  }
  if (draft.apiKeyEnv?.trim()) {
    source.apiKeyEnv = draft.apiKeyEnv.trim();
  }
  if (draft.apiKeyRef?.trim()) {
    source.apiKeyRef = draft.apiKeyRef.trim();
  }
  if (draft.baseUrl?.trim()) {
    source.baseUrl = draft.baseUrl.trim();
  }
  if (draft.command?.trim()) {
    source.command = draft.command.trim();
  }
  const args = (draft.args ?? '')
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (args.length > 0) {
    source.args = args;
  }
  return source;
}

function positiveInt(raw: string): number | undefined {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return Math.floor(value);
}

function uniqueSourceId(kind: WebSearchSourceKind, existingIds: readonly string[]): string {
  if (!existingIds.includes(kind)) {
    return kind;
  }
  let index = 2;
  while (existingIds.includes(`${kind}-${index}`)) {
    index += 1;
  }
  return `${kind}-${index}`;
}
