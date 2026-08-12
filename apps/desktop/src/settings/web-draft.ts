/**
 * Pure draft<->config conversion for the Web tools settings form.
 * Draft keeps raw strings so users can type freely; parsing happens on save.
 */
import {
  DEFAULT_SEARCH_ROUTE_POLICY,
  type ModelRef,
  type SearchRoutePolicy,
  type WebConfig,
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
  searchRoutePolicy: SearchRoutePolicy;
  perSourceTimeoutMs: string;
  searchMaxResults: string;
  searchTimeoutMs: string;
  fetchProvider: WebConfig['fetchProvider'];
  fetchApiKeyRef: string;
  fetchApiKeyEnv: string;
  fetchMaxBytes: string;
  fetchTimeoutMs: string;
  fetchBlockedUrlPrefixes: string;
};

export function webToDraft(web: WebConfig): DraftWeb {
  return {
    searchSources: web.searchSources.map(sourceToDraft),
    ...(web.searchDelegateModel ? { searchDelegateModel: web.searchDelegateModel } : {}),
    searchRoutePolicy: web.searchRoutePolicy ?? DEFAULT_SEARCH_ROUTE_POLICY,
    perSourceTimeoutMs: String(web.searchStrategy.perSourceTimeoutMs),
    searchMaxResults: String(web.searchMaxResults),
    searchTimeoutMs: String(web.searchTimeoutMs),
    fetchProvider: web.fetchProvider,
    fetchApiKeyRef: web.fetchApiKeyRef ?? '',
    fetchApiKeyEnv: web.fetchApiKeyEnv,
    fetchMaxBytes: String(web.fetchMaxBytes),
    fetchTimeoutMs: String(web.fetchTimeoutMs),
    fetchBlockedUrlPrefixes: web.fetchBlockedUrlPrefixes.join(', '),
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
  return {
    searchProvider,
    searchApiKeyEnv: firstKey,
    searchRoutePolicy: draft.searchRoutePolicy,
    searchMaxResults: Number.isFinite(maxResults) && maxResults > 0 ? Math.floor(maxResults) : 10,
    searchTimeoutMs:
      Number.isFinite(searchTimeoutMs) && searchTimeoutMs > 0 ? Math.floor(searchTimeoutMs) : 15000,
    searchSources,
    ...(draft.searchDelegateModel ? { searchDelegateModel: draft.searchDelegateModel } : {}),
    searchStrategy: {
      // Multi-source search is always parallel (aggregate + URL dedupe).
      mode: 'parallel',
      perSourceTimeoutMs:
        Number.isFinite(perSourceTimeoutMs) && perSourceTimeoutMs > 0
          ? Math.floor(perSourceTimeoutMs)
          : 8000,
    },
    fetchProvider: draft.fetchProvider,
    ...(draft.fetchApiKeyRef.trim() ? { fetchApiKeyRef: draft.fetchApiKeyRef.trim() } : {}),
    fetchApiKeyEnv: draft.fetchApiKeyEnv.trim() || 'FIRECRAWL_API_KEY',
    fetchMaxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 65536,
    fetchTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 15000,
    fetchBlockedUrlPrefixes: draft.fetchBlockedUrlPrefixes
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
    id: draft.id.trim() || draft.kind,
    kind: draft.kind,
    enabled: draft.enabled,
  };
  if (draft.label.trim()) {
    source.label = draft.label.trim();
  }
  if (draft.apiKeyEnv.trim()) {
    source.apiKeyEnv = draft.apiKeyEnv.trim();
  }
  if (draft.apiKeyRef.trim()) {
    source.apiKeyRef = draft.apiKeyRef.trim();
  }
  if (draft.baseUrl.trim()) {
    source.baseUrl = draft.baseUrl.trim();
  }
  if (draft.command.trim()) {
    source.command = draft.command.trim();
  }
  const args = draft.args
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (args.length > 0) {
    source.args = args;
  }
  return source;
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
