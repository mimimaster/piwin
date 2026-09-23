import type { SearchHit, WebSearchSource } from '@piwin/contracts';
import type { SearchProvider } from './search-source-providers.js';

/**
 * Same hosts and body as ~/Projects/windsurf-search-mcp/bin/windsurf-search.mjs.
 * The key is sent as stored: `devin-session-token$…` and legacy `sk-ws-*` are
 * both valid. Do not rewrite the prefix.
 */
const DEVIN_HOSTS = ['https://server.codeium.com', 'https://server.self-serve.windsurf.com'] as const;
const DEVIN_SEARCH_PATH = '/exa.api_server_pb.ApiServerService/GetWebSearchResults';
const DEVIN_IDE_VERSION = '1.9600.41';

type DevinSearchResult = Record<string, unknown>;

function resolveDevinApiKey(source: WebSearchSource, runtimeApiKey?: string): string {
  const fromRuntime = runtimeApiKey?.trim();
  const envName = source.apiKeyEnv?.trim();
  const fromSourceEnv = envName ? process.env[envName]?.trim() : undefined;
  const fromDefaultEnv = process.env.WINDSURF_API_KEY?.trim();
  const raw = fromRuntime || fromSourceEnv || fromDefaultEnv || '';
  if (!raw) {
    throw new Error('Missing Devin API key (oauth:devin or WINDSURF_API_KEY)');
  }
  return raw;
}

function clampDevinLimit(limit: number): number {
  return Math.min(Math.max(limit, 1), 10);
}

function firstString(record: DevinSearchResult, keys: readonly string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function devinRequestInit(
  apiKey: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): RequestInit {
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Connect-Protocol-Version': '1',
      Accept: 'application/json',
      'User-Agent': `windsurf/${DEVIN_IDE_VERSION}`,
    },
    body: JSON.stringify({
      metadata: {
        apiKey,
        ideName: 'windsurf',
        ideVersion: DEVIN_IDE_VERSION,
        extensionName: 'windsurf',
        extensionVersion: DEVIN_IDE_VERSION,
        locale: 'en',
      },
      query,
      limit,
    }),
  };
  if (signal) {
    init.signal = signal;
  }
  return init;
}

function hitsFromDevinPayload(payload: unknown, sourceId: string, limit: number): SearchHit[] {
  const rows = (payload as { results?: DevinSearchResult[] } | null)?.results;
  if (!Array.isArray(rows)) {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    const title = firstString(row, ['title', 'name', 'webTitle']);
    const url = firstString(row, ['url', 'sourceUrl', 'webUrl', 'link']);
    if (!title || !url) {
      continue;
    }
    hits.push({
      title,
      url,
      snippet: firstString(row, ['snippet', 'summary', 'text', 'content']),
      source: sourceId,
    });
    if (hits.length >= limit) {
      break;
    }
  }
  return hits;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError');
}

/**
 * Devin / Windsurf web search. Walks the same host list as windsurf-search.mjs
 * until one returns 2xx. Abort does not continue to the next host.
 */
export function createDevinProvider(
  source: WebSearchSource,
  runtimeApiKey?: string,
): SearchProvider {
  return {
    id: source.id,
    async search(query, options) {
      const trimmed = query.trim();
      if (!trimmed) {
        throw new Error('Devin search query is empty');
      }
      const apiKey = resolveDevinApiKey(source, runtimeApiKey);
      const limit = clampDevinLimit(options.limit);
      const init = devinRequestInit(apiKey, trimmed, limit, options.signal);
      let lastError: Error | undefined;
      for (const host of DEVIN_HOSTS) {
        try {
          const response = await fetch(`${host}${DEVIN_SEARCH_PATH}`, init);
          if (!response.ok) {
            lastError = new Error(`Devin search failed: HTTP ${response.status}`);
            continue;
          }
          const payload: unknown = await response.json();
          return hitsFromDevinPayload(payload, source.id, limit);
        } catch (error) {
          if (isAbortError(error) || options.signal?.aborted) {
            throw error instanceof Error ? error : new Error(String(error));
          }
          lastError = error instanceof Error ? error : new Error(String(error));
        }
      }
      throw lastError ?? new Error('Devin search failed on all hosts');
    },
  };
}
