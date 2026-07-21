import { describe, expect, it } from 'vitest';
import { createSearchProvider, webSearch } from './search-provider.js';

describe('search providers', () => {
  it('none provider errors clearly', async () => {
    const provider = createSearchProvider({
      searchProvider: 'none',
      searchApiKeyEnv: 'X',
      searchMaxResults: 3,
      fetchMaxBytes: 1000,
      fetchTimeoutMs: 1000,
      fetchBlockedUrlPrefixes: [],
    });
    await expect(provider.search('q', { limit: 3 })).rejects.toThrow(/disabled/);
  });

  it('brave requires api key', async () => {
    const previous = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    try {
      await expect(
        webSearch('test', { searchProvider: 'brave', searchApiKeyEnv: 'BRAVE_API_KEY' }),
      ).rejects.toThrow(/Missing API key/);
    } finally {
      if (previous !== undefined) {
        process.env.BRAVE_API_KEY = previous;
      }
    }
  });
});
