import { describe, expect, it } from 'vitest';
import { assertSafeFetchUrl, validateFetchUrl, webFetch } from './web-fetch.js';

describe('validateFetchUrl', () => {
  it('allows https', () => {
    expect(validateFetchUrl('https://example.com/a', [])).toContain('https://example.com');
  });
  it('blocks file and localhost', () => {
    expect(() => validateFetchUrl('file:///etc/passwd', ['file:'])).toThrow(/blocked|only http/);
    expect(() => validateFetchUrl('http://127.0.0.1/x', [])).toThrow(/private|local|blocked/);
    expect(() => validateFetchUrl('http://192.168.1.5/x', [])).toThrow(/private|local|blocked/);
  });
});

describe('assertSafeFetchUrl DNS', () => {
  it('blocks hostnames that resolve to private IPs', async () => {
    await expect(
      assertSafeFetchUrl('https://evil.example/', [], async () => ['10.0.0.5']),
    ).rejects.toThrow(/SSRF|private/);
  });

  it('allows hostnames that resolve to public IPs', async () => {
    const url = await assertSafeFetchUrl('https://example.com/', [], async () => ['93.184.216.34']);
    expect(url).toContain('example.com');
  });
});

describe('webFetch', () => {
  it('uses a host-resolved Firecrawl credential without an environment variable', async () => {
    const previousKey = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    let authorizationHeader = '';
    try {
      const result = await webFetch('https://example.com/article', {
        apiKey: 'keychain-firecrawl-secret',
        fetchImpl: async (_input, init) => {
          authorizationHeader = String(
            (init?.headers as Record<string, string> | undefined)?.Authorization ?? '',
          );
          return new Response(
            JSON.stringify({
              success: true,
              data: { markdown: '# Article\nBody', metadata: { title: 'Article' } },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
        config: {
          fetchProvider: 'firecrawl',
          fetchApiKeyRef: 'keychain:piwin-web-fetch-firecrawl',
          fetchBlockedUrlPrefixes: [],
        },
      });
      expect(authorizationHeader).toBe('Bearer keychain-firecrawl-secret');
      expect(result.title).toBe('Article');
    } finally {
      if (previousKey !== undefined) {
        process.env.FIRECRAWL_API_KEY = previousKey;
      }
    }
  });

  it('returns bounded partial markdown from Jina when the provider response is oversized', async () => {
    const result = await webFetch('https://example.com/jina', {
      fetchImpl: async () =>
        new Response('z'.repeat(5000), {
          status: 200,
          headers: { 'content-type': 'text/markdown' },
        }),
      config: {
        fetchProvider: 'jina',
        fetchMaxBytes: 100,
        fetchTimeoutMs: 5000,
        fetchBlockedUrlPrefixes: [],
      },
    });

    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe('response-limit');
    expect(result.text).toBe('z'.repeat(100));
  });

  it('returns a structured truncation notice when Firecrawl JSON is oversized', async () => {
    const body = JSON.stringify({
      success: true,
      data: { markdown: 'q'.repeat(5000) },
    });
    const result = await webFetch('https://example.com/firecrawl', {
      apiKey: 'firecrawl-test-key',
      fetchImpl: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      config: {
        fetchProvider: 'firecrawl',
        fetchMaxBytes: 100,
        fetchTimeoutMs: 5000,
        fetchBlockedUrlPrefixes: [],
      },
    });

    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe('response-limit');
    expect(result.text).toContain('retry with the supermarkdown or jina fetch provider');
  });

  it('extracts text from html via mock fetch', async () => {
    const html = '<html><head><title>Hello</title></head><body><p>World article</p></body></html>';
    const result = await webFetch('https://example.com/post', {
      fetchImpl: async () =>
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
      resolveHostAddresses: async () => ['93.184.216.34'],
      config: { fetchMaxBytes: 10000, fetchTimeoutMs: 5000, fetchBlockedUrlPrefixes: [] },
    });
    expect(result.title).toBe('Hello');
    expect(result.text.toLowerCase()).toContain('world');
    expect(result.truncated).toBe(false);
  });

  it('revalidates redirects and blocks private hop', async () => {
    let calls = 0;
    await expect(
      webFetch('https://example.com/start', {
        maxRedirects: 3,
        resolveHostAddresses: async (hostname) => {
          if (hostname === 'example.com') return ['93.184.216.34'];
          return ['127.0.0.1'];
        },
        fetchImpl: async (input) => {
          calls += 1;
          const url = String(input);
          if (url.includes('/start')) {
            return new Response(null, {
              status: 302,
              headers: { location: 'http://internal.local/secret' },
            });
          }
          return new Response('should-not-reach', { status: 200 });
        },
        config: { fetchMaxBytes: 1000, fetchTimeoutMs: 5000, fetchBlockedUrlPrefixes: [] },
      }),
    ).rejects.toThrow(/private|local|SSRF|blocked/);
    expect(calls).toBe(1);
  });

  it('returns a bounded partial result when the response exceeds the stream cap', async () => {
    const body = 'x'.repeat(5000);
    const result = await webFetch('https://example.com/big', {
      resolveHostAddresses: async () => ['93.184.216.34'],
      fetchImpl: async () =>
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      config: {
        fetchMaxBytes: 100,
        fetchTimeoutMs: 5000,
        fetchBlockedUrlPrefixes: [],
      },
    });

    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe('response-limit');
    expect(result.byteSize).toBe(400);
    expect(result.text).toHaveLength(100);
    expect(result.text).toBe('x'.repeat(100));
  });

  it('marks text-only truncation when the raw response fits the stream cap', async () => {
    const result = await webFetch('https://example.com/text', {
      resolveHostAddresses: async () => ['93.184.216.34'],
      fetchImpl: async () =>
        new Response('y'.repeat(300), {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      config: {
        fetchMaxBytes: 100,
        fetchTimeoutMs: 5000,
        fetchBlockedUrlPrefixes: [],
      },
    });

    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toBe('text-limit');
    expect(result.byteSize).toBe(300);
    expect(result.text).toBe('y'.repeat(100));
  });

  it('caps oversized HTML before parsing so a giant page cannot stall', async () => {
    const paragraphs = '<p>' + 'lorem ipsum dolor '.repeat(25) + '</p>';
    const html = `<html><head><title>Giant page</title></head><body>${paragraphs}</body></html>`;
    // fetchMaxBytes=200 → hard cap 800, parse cap 400. Body ~500 chars stays under
    // the stream cap but above the parse cap, so the parser sees a truncated page.
    const result = await webFetch('https://example.com/giant', {
      resolveHostAddresses: async () => ['93.184.216.34'],
      fetchImpl: async () =>
        new Response(html, {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      config: {
        fetchMaxBytes: 200,
        fetchTimeoutMs: 5000,
        fetchBlockedUrlPrefixes: [],
      },
    });
    expect(result.title).toBe('Giant page');
    expect(result.text.length).toBeGreaterThan(0);
  });
});
