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
});
