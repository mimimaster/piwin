import type { WebConfig } from '@piwin/contracts';
import type { FetchStoreRecord } from './fetch-cache.js';

export function shouldRetryFetchFallback(
  stored: FetchStoreRecord,
  config: Pick<WebConfig, 'fetchProvider' | 'fetchFallback'>,
): boolean {
  return (
    (config.fetchFallback === 'jina' || config.fetchFallback === 'browser') &&
    config.fetchProvider === 'supermarkdown' &&
    stored.thinContent === true &&
    stored.skipView !== true &&
    stored.provider === 'supermarkdown'
  );
}

/**
 * One-shot jina/browser retry after a thin local extract.
 * Failed or still-shorter fallback keeps the original record.
 */
export async function applyFetchFallback(
  stored: FetchStoreRecord,
  config: Pick<WebConfig, 'fetchProvider' | 'fetchFallback'>,
  retry: () => Promise<FetchStoreRecord>,
  signal?: AbortSignal,
): Promise<FetchStoreRecord> {
  if (!shouldRetryFetchFallback(stored, config)) {
    return stored;
  }
  try {
    const fallback = await retry();
    if (fallback.text.trim().length > stored.text.trim().length) {
      return fallback;
    }
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
  }
  return stored;
}
