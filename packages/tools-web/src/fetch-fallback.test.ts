import { describe, expect, it, vi } from 'vitest';
import { applyFetchFallback, shouldRetryFetchFallback } from './fetch-fallback.js';
import type { FetchStoreRecord } from './fetch-cache.js';

const thinLocal: FetchStoreRecord = {
  url: 'https://example.com/app',
  finalUrl: 'https://example.com/app',
  title: 'App',
  text: 'Loading',
  contentType: 'text/html',
  byteSize: 80,
  truncated: false,
  outline: [],
  provider: 'supermarkdown',
  thinContent: true,
};

describe('applyFetchFallback', () => {
  it('retries jina once and keeps the richer extract', async () => {
    const retry = vi.fn(async (): Promise<FetchStoreRecord> => ({
      ...thinLocal,
      text: 'Rendered article body after JavaScript.',
      provider: 'jina',
      thinContent: false,
    }));
    const result = await applyFetchFallback(
      thinLocal,
      { fetchProvider: 'supermarkdown', fetchFallback: 'jina' },
      retry,
    );
    expect(retry).toHaveBeenCalledOnce();
    expect(result.provider).toBe('jina');
    expect(result.text).toContain('Rendered article');
  });

  it('keeps the local extract when jina fails', async () => {
    const result = await applyFetchFallback(
      thinLocal,
      { fetchProvider: 'supermarkdown', fetchFallback: 'jina' },
      async () => {
        throw new Error('jina down');
      },
    );
    expect(result).toBe(thinLocal);
  });

  it('does not retry when fallback is none', () => {
    expect(
      shouldRetryFetchFallback(thinLocal, { fetchProvider: 'supermarkdown', fetchFallback: 'none' }),
    ).toBe(false);
  });

  it('retries when fallback is browser', () => {
    expect(
      shouldRetryFetchFallback(thinLocal, {
        fetchProvider: 'supermarkdown',
        fetchFallback: 'browser',
      }),
    ).toBe(true);
  });
});
