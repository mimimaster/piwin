import type { WebFetchResult, WebFetchSpillStore } from '@piwin/contracts';
import type { FetchStoreRecord } from './fetch-cache.js';

export async function attachFetchSpill(
  result: WebFetchResult,
  stored: FetchStoreRecord,
  spillStore: WebFetchSpillStore | undefined,
  signal?: AbortSignal,
): Promise<WebFetchResult> {
  if (!spillStore || result.hasMore !== true || stored.text.length === 0) {
    return result;
  }
  if (signal?.aborted) {
    throw new Error('web_fetch spill aborted');
  }
  try {
    const spillPath = await spillStore.write({ url: stored.finalUrl, text: stored.text });
    return { ...result, spillPath };
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }
    return result;
  }
}
