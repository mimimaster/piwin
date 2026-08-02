/**
 * Pure draft<->config conversion for the Web tools settings form.
 * Draft keeps raw strings so users can type freely; parsing happens on save.
 */
import type {
  WebConfig,
  WebSearchSource,
  WebSearchSourceKind,
  WebSearchStrategyMode,
} from '@piwin/contracts';

export type DraftSearchSource = {
  id: string;
  kind: WebSearchSourceKind;
  enabled: boolean;
  label: string;
  apiKeyEnv: string;
  baseUrl: string;
  command: string;
  /** Space-separated argv; use {{query}} for the search query token. */
  args: string;
};

export type DraftWeb = {
  searchSources: DraftSearchSource[];
  searchStrategyMode: WebSearchStrategyMode;
  perSourceTimeoutMs: string;
  searchMaxResults: string;
  searchTimeoutMs: string;
  fetchProvider: WebConfig['fetchProvider'];
  fetchApiKeyEnv: string;
  fetchMaxBytes: string;
  fetchTimeoutMs: string;
  fetchBlockedUrlPrefixes: string;
};

export function webToDraft(web: WebConfig): DraftWeb {
  return {
    searchSources: web.searchSources.map(sourceToDraft),
    searchStrategyMode: web.searchStrategy.mode,
    perSourceTimeoutMs: String(web.searchStrategy.perSourceTimeoutMs),
    searchMaxResults: String(web.searchMaxResults),
    searchTimeoutMs: String(web.searchTimeoutMs),
    fetchProvider: web.fetchProvider,
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
    searchMaxResults:
      Number.isFinite(maxResults) && maxResults > 0 ? Math.floor(maxResults) : 10,
    searchTimeoutMs:
      Number.isFinite(searchTimeoutMs) && searchTimeoutMs > 0
        ? Math.floor(searchTimeoutMs)
        : 15000,
    searchSources,
    searchStrategy: {
      mode:
        draft.searchStrategyMode === 'ordered-fallback' ? 'ordered-fallback' : 'parallel',
      perSourceTimeoutMs:
        Number.isFinite(perSourceTimeoutMs) && perSourceTimeoutMs > 0
          ? Math.floor(perSourceTimeoutMs)
          : 8000,
    },
    fetchProvider: draft.fetchProvider,
    fetchApiKeyEnv: draft.fetchApiKeyEnv.trim() || 'FIRECRAWL_API_KEY',
    fetchMaxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? Math.floor(maxBytes) : 65536,
    fetchTimeoutMs:
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 15000,
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
    base.command = 'my-search';
    base.args = 'search {{query}}';
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
    baseUrl: source.baseUrl ?? '',
    command: source.command ?? '',
    args: (source.args ?? []).join(' '),
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
  if (draft.baseUrl.trim()) {
    source.baseUrl = draft.baseUrl.trim();
  }
  if (draft.command.trim()) {
    source.command = draft.command.trim();
  }
  const args = draft.args
    .trim()
    .split(/\s+/)
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
