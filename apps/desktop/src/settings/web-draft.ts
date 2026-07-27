/**
 * Pure draft<->config conversion for the Web tools settings form.
 * Draft keeps raw strings so users can type freely; parsing happens on save.
 */
import type { WebConfig } from '@piwin/contracts';

export type DraftWeb = {
  searchProvider: WebConfig['searchProvider'];
  searchApiKeyEnv: string;
  searchMaxResults: string;
  fetchProvider: WebConfig['fetchProvider'];
  fetchApiKeyEnv: string;
  fetchMaxBytes: string;
  fetchTimeoutMs: string;
  fetchBlockedUrlPrefixes: string;
};

export function webToDraft(web: WebConfig): DraftWeb {
  return {
    searchProvider: web.searchProvider,
    searchApiKeyEnv: web.searchApiKeyEnv,
    searchMaxResults: String(web.searchMaxResults),
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
  return {
    searchProvider: draft.searchProvider,
    searchApiKeyEnv: draft.searchApiKeyEnv.trim(),
    searchMaxResults:
      Number.isFinite(maxResults) && maxResults > 0 ? Math.floor(maxResults) : 5,
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
