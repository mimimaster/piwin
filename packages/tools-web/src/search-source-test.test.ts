import { afterEach, describe, expect, it, vi } from 'vitest';
import { testSearchSource } from './search-source-test.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('testSearchSource', () => {
  it('runs a one-result Brave connectivity check with host credentials', async () => {
    let receivedToken = '';
    vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
      receivedToken = String(
        (init?.headers as Record<string, string> | undefined)?.['X-Subscription-Token'] ?? '',
      );
      return new Response(
        JSON.stringify({
          web: {
            results: [{ title: 'piwin', url: 'https://example.com/piwin', description: 'test' }],
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch);

    const result = await testSearchSource(
      { id: 'brave', kind: 'brave', enabled: true, apiKeyRef: 'keychain:piwin-web-brave' },
      { searchApiKeysBySourceId: { brave: 'secret-from-keychain' } },
    );

    expect(receivedToken).toBe('secret-from-keychain');
    expect(result).toMatchObject({ sourceId: 'brave', kind: 'brave', resultCount: 1 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('rejects unsupported source kinds', async () => {
    await expect(
      testSearchSource({ id: 'duckduckgo', kind: 'duckduckgo', enabled: true }),
    ).rejects.toThrow(/does not support connectivity tests/);
  });

  it('rejects a CLI source without {{query}}', async () => {
    await expect(
      testSearchSource({
        id: 'cli',
        kind: 'cli',
        enabled: true,
        command: 'my-search',
        args: ['--limit', '5'],
      }),
    ).rejects.toThrow(/{{query}}/);
  });

  it('tests an HTTP source with a small POST', async () => {
    vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      return new Response(JSON.stringify({ hits: [{ title: 'piwin', url: 'https://example.com', snippet: '' }] }), {
        status: 200,
      });
    }) as typeof fetch);

    const result = await testSearchSource({
      id: 'http',
      kind: 'http',
      enabled: true,
      baseUrl: 'http://127.0.0.1:8787/search',
    });
    expect(result).toMatchObject({ sourceId: 'http', kind: 'http', resultCount: 1 });
  });
});
