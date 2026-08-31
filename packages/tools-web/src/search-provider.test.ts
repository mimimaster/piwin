import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSearchProvider, resolveWebConfig, webSearch } from './search-provider.js';
import { mergeSearchHitBatches, normalizeSearchHitUrl } from './search-merge.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function ddgBlockedResponse(): Response {
  return new Response('{}', { status: 202 });
}

describe('search providers', () => {
  it('none / empty sources errors clearly', async () => {
    const provider = createSearchProvider({
      searchProvider: 'none',
      searchSources: [],
    });
    await expect(provider.search('q', { limit: 3 })).rejects.toThrow(/disabled/);
  });

  it('packing default via resolveWebConfig is native-first with no external sources', () => {
    const resolved = resolveWebConfig();
    expect(resolved.searchProvider).toBe('none');
    expect(resolved.searchSources).toEqual([]);
    expect(resolved.searchRoutePolicy).toBe('native-first');
    expect(resolved.fetchProvider).toBe('supermarkdown');
    expect(resolved.searchTimeoutMs).toBe(15000);
    expect(resolved.searchStrategy.mode).toBe('parallel');
  });

  it('migrates legacy brave searchProvider into searchSources', () => {
    const resolved = resolveWebConfig({
      searchProvider: 'brave',
      searchApiKeyEnv: 'MY_BRAVE',
    });
    expect(resolved.searchSources).toEqual([
      {
        id: 'brave',
        kind: 'brave',
        enabled: true,
        apiKeyEnv: 'MY_BRAVE',
      },
    ]);
    expect(resolved.searchProvider).toBe('brave');
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

  it('uses a host-resolved keychain credential before environment variables', async () => {
    const previous = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;
    let authorizationHeader = '';
    vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
      authorizationHeader = String(
        (init?.headers as Record<string, string> | undefined)?.['X-Subscription-Token'] ?? '',
      );
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    }) as typeof fetch);
    try {
      await webSearch(
        'test',
        {
          searchSources: [
            {
              id: 'brave',
              kind: 'brave',
              enabled: true,
              apiKeyRef: 'keychain:piwin-web-brave',
            },
          ],
        },
        undefined,
        { searchApiKeysBySourceId: { brave: 'keychain-secret' } },
      );
      expect(authorizationHeader).toBe('keychain-secret');
    } finally {
      if (previous !== undefined) {
        process.env.BRAVE_API_KEY = previous;
      }
    }
  });

  it('times out when the provider network hangs', async () => {
    const previousKey = process.env.BRAVE_API_KEY;
    process.env.BRAVE_API_KEY = 'test-key';
    vi.stubGlobal(
      'fetch',
      ((input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        })) as typeof fetch,
    );
    try {
      await expect(
        webSearch('test', { searchProvider: 'brave', searchTimeoutMs: 40 }),
      ).rejects.toThrow(/timed out after 40ms/);
    } finally {
      if (previousKey === undefined) {
        delete process.env.BRAVE_API_KEY;
      } else {
        process.env.BRAVE_API_KEY = previousKey;
      }
    }
  });

  it('surfaces DuckDuckGo 202 bot-blocking instead of silent empty hits', async () => {
    vi.stubGlobal('fetch', (async () => ddgBlockedResponse()) as typeof fetch);
    await expect(
      webSearch('test', { searchProvider: 'duckduckgo', searchTimeoutMs: 1000 }),
    ).rejects.toThrow(/202|blocked|rate limiting/);
  });

  it('adds a warning when the provider returns zero hits', async () => {
    vi.stubGlobal('fetch', (async (input: unknown) => {
      const url = String(input);
      if (url.includes('api.duckduckgo.com')) {
        return new Response('{"Results":[],"RelatedTopics":[]}', { status: 200 });
      }
      return new Response(
        '<!DOCTYPE html><html><head><title>No results</title></head><body>Nothing</body></html>',
        { status: 200 },
      );
    }) as typeof fetch);
    const result = await webSearch('zzz-no-such-thing', {
      searchProvider: 'duckduckgo',
      searchTimeoutMs: 1000,
    });
    expect(result.hits).toEqual([]);
    expect(result.warning).toContain('No results returned');
  });

  it('aggregates multiple sources with URL dedupe (parallel)', async () => {
    vi.stubGlobal('fetch', (async (input: unknown) => {
      const url = String(input);
      if (url.includes('api.search.brave.com')) {
        return new Response(
          JSON.stringify({
            web: {
              results: [
                {
                  title: 'Shared',
                  url: 'https://example.com/a',
                  description: 'from brave',
                },
                {
                  title: 'Brave only',
                  url: 'https://brave.example/b',
                  description: 'brave unique',
                },
              ],
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes('api.tavily.com')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: 'Shared again',
                url: 'https://example.com/a/',
                content: 'from tavily',
              },
              {
                title: 'Tavily only',
                url: 'https://tavily.example/c',
                content: 'tavily unique',
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch);
    process.env.BRAVE_API_KEY = 'brave-test';
    process.env.TAVILY_API_KEY = 'tavily-test';
    try {
      const result = await webSearch('multi', {
        searchSources: [
          { id: 'brave', kind: 'brave', enabled: true, apiKeyEnv: 'BRAVE_API_KEY' },
          { id: 'tavily', kind: 'tavily', enabled: true, apiKeyEnv: 'TAVILY_API_KEY' },
        ],
        searchStrategy: { mode: 'parallel', perSourceTimeoutMs: 5000 },
        searchMaxResults: 10,
        searchTimeoutMs: 5000,
      });
      expect(result.providerId.startsWith('aggregate:')).toBe(true);
      const urls = result.hits.map((hit) => hit.url);
      expect(urls).toContain('https://example.com/a');
      expect(urls).toContain('https://brave.example/b');
      expect(urls).toContain('https://tavily.example/c');
      // Shared URL appears once after normalize trailing slash
      expect(
        urls.filter(
          (item) => normalizeSearchHitUrl(item) === normalizeSearchHitUrl('https://example.com/a'),
        ).length,
      ).toBe(1);
    } finally {
      delete process.env.BRAVE_API_KEY;
      delete process.env.TAVILY_API_KEY;
    }
  });

  it('searxng provider hits /search?format=json', async () => {
    vi.stubGlobal('fetch', (async (input: unknown) => {
      const url = String(input);
      expect(url).toContain('http://127.0.0.1:8080/search');
      expect(url).toContain('format=json');
      return new Response(
        JSON.stringify({
          results: [
            {
              title: 'Docs',
              url: 'https://docs.example/x',
              content: 'snippet',
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch);
    const result = await webSearch('docs', {
      searchSources: [
        {
          id: 'searx',
          kind: 'searxng',
          enabled: true,
          baseUrl: 'http://127.0.0.1:8080',
        },
      ],
      searchTimeoutMs: 2000,
    });
    expect(result.hits).toEqual([
      {
        title: 'Docs',
        url: 'https://docs.example/x',
        snippet: 'snippet',
        source: 'searx',
      },
    ]);
  });

  it('http provider POSTs query/count and accepts link as url', async () => {
    vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ query: 'docs', count: 5 });
      return new Response(
        JSON.stringify([{ title: 'Hit', link: 'https://example.com/h', snippet: 's' }]),
        { status: 200 },
      );
    }) as typeof fetch);
    const result = await webSearch('docs', {
      searchSources: [
        {
          id: 'custom-http',
          kind: 'http',
          enabled: true,
          baseUrl: 'http://127.0.0.1:8787/search',
        },
      ],
      searchMaxResults: 5,
      searchTimeoutMs: 2000,
    });
    expect(result.hits).toEqual([
      {
        title: 'Hit',
        url: 'https://example.com/h',
        snippet: 's',
        source: 'custom-http',
      },
    ]);
  });

  it('cli provider merges extra env into spawn', async () => {
    const result = await webSearch('docs', {
      searchSources: [
        {
          id: 'cli',
          kind: 'cli',
          enabled: true,
          command: process.execPath,
          args: [
            '-e',
            'process.stdout.write(JSON.stringify({hits:[{title:process.env.SEARCH_FLAG||"",url:"https://example.com/x",snippet:""}]}))',
            '{{query}}',
          ],
          env: { SEARCH_FLAG: 'from-env' },
        },
      ],
      searchTimeoutMs: 5000,
    });
    expect(result.hits).toEqual([
      {
        title: 'from-env',
        url: 'https://example.com/x',
        snippet: '',
        source: 'cli',
      },
    ]);
  });
});

describe('mergeSearchHitBatches', () => {
  it('round-robins and dedupes by normalized URL', () => {
    const merged = mergeSearchHitBatches(
      [
        {
          sourceId: 'a',
          hits: [
            { title: 'A1', url: 'https://ex.com/1', snippet: '' },
            { title: 'A2', url: 'https://ex.com/2', snippet: '' },
          ],
        },
        {
          sourceId: 'b',
          hits: [
            { title: 'B1', url: 'https://ex.com/1/', snippet: 'dup' },
            { title: 'B2', url: 'https://ex.com/3', snippet: '' },
          ],
        },
      ],
      10,
    );
    // round-robin index0: A1, B1(dup skip); index1: A2, B2
    expect(merged.map((hit) => ({ url: hit.url, source: hit.source }))).toEqual([
      { url: 'https://ex.com/1', source: 'a' },
      { url: 'https://ex.com/2', source: 'a' },
      { url: 'https://ex.com/3', source: 'b' },
    ]);
  });
});
