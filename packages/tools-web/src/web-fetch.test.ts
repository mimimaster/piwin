import { describe, expect, it, vi } from 'vitest';
import { FetchCache, assertSafeFetchUrl, validateFetchUrl, webFetch } from './web-fetch.js';

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

  it('reuses a cached extraction and serves offset/outline views without another GET', async () => {
    let calls = 0;
    const html =
      '<html><head><title>Long</title></head><body><h1>Intro</h1><p>' +
      'word '.repeat(80) +
      '</p><h2>API</h2></body></html>';
    const cache = new FetchCache();
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };
    const config = {
      fetchMaxBytes: 10_000,
      fetchReturnMaxChars: 40,
      fetchStoreMaxChars: 4000,
      fetchTimeoutMs: 5000,
      fetchBlockedUrlPrefixes: [] as string[],
    };
    const first = await webFetch('https://example.com/long', {
      fetchImpl,
      resolveHostAddresses: async () => ['93.184.216.34'],
      cache,
      config,
    });
    expect(calls).toBe(1);
    expect(first.fromCache).toBe(false);
    expect(first.extraction).toBe('head');
    expect(first.hasMore).toBe(true);
    expect(first.text.length).toBe(40);
    expect(first.outline).toContain('Intro');
    expect(first.nextOffset).toBeDefined();

    const continued = await webFetch('https://example.com/long', {
      fetchImpl,
      resolveHostAddresses: async () => ['93.184.216.34'],
      cache,
      config,
      ...(first.nextOffset !== undefined ? { view: { offset: first.nextOffset } } : {}),
    });
    expect(calls).toBe(1);
    expect(continued.fromCache).toBe(true);
    expect(continued.extraction).toBe('offset');
    expect(continued.range?.start).toBe(40);

    const outline = await webFetch('https://example.com/long', {
      fetchImpl,
      resolveHostAddresses: async () => ['93.184.216.34'],
      cache,
      config,
      view: { outline: true },
    });
    expect(calls).toBe(1);
    expect(outline.extraction).toBe('outline');
    expect(outline.text).toContain('- Intro');
  });

  it('marks a SPA shell as thinContent when fallback is off', async () => {
    const spa =
      '<html><head><title>App</title></head><body><div id="root"></div>' +
      '<script>window.__NEXT_DATA__={}</script></body></html>';
    const result = await webFetch('https://example.com/app', {
      fetchImpl: async () =>
        new Response(spa, { status: 200, headers: { 'content-type': 'text/html' } }),
      resolveHostAddresses: async () => ['93.184.216.34'],
      config: { fetchBlockedUrlPrefixes: [], fetchFallback: 'none' },
    });
    expect(result.provider).toBe('supermarkdown');
    expect(result.thinContent).toBe(true);
  });

  it('retries a thin SPA page with jina and labels the actual provider', async () => {
    const spa =
      '<html><head><title>App</title></head><body><div id="root"></div>' +
      '<script>window.__NEXT_DATA__={}</script></body></html>';
    const urls: string[] = [];
    const result = await webFetch('https://example.com/app', {
      fetchImpl: async (input) => {
        const href = String(input);
        urls.push(href);
        if (href.startsWith('https://r.jina.ai/')) {
          return new Response('# Docs\n\nRendered article body after JavaScript hydration.', {
            status: 200,
            headers: { 'content-type': 'text/markdown' },
          });
        }
        return new Response(spa, { status: 200, headers: { 'content-type': 'text/html' } });
      },
      resolveHostAddresses: async () => ['93.184.216.34'],
      config: { fetchBlockedUrlPrefixes: [], fetchFallback: 'jina' },
    });
    expect(urls.some((href) => href.includes('example.com/app'))).toBe(true);
    expect(urls.some((href) => href.startsWith('https://r.jina.ai/'))).toBe(true);
    expect(result.provider).toBe('jina');
    expect(result.thinContent).toBeUndefined();
    expect(result.text).toContain('Rendered article body after JavaScript hydration.');
  });

  it('retries a thin SPA page with the injected browser renderer', async () => {
    const spa =
      '<html><head><title>App</title></head><body><div id="root"></div>' +
      '<script>window.__NEXT_DATA__={}</script></body></html>';
    const rendered =
      '<html><head><title>Docs</title></head><body><article><h1>Docs</h1>' +
      '<p>Rendered article body after JavaScript hydration.</p></article></body></html>';
    const result = await webFetch('https://example.com/app', {
      fetchImpl: async () =>
        new Response(spa, { status: 200, headers: { 'content-type': 'text/html' } }),
      resolveHostAddresses: async () => ['93.184.216.34'],
      config: { fetchBlockedUrlPrefixes: [], fetchFallback: 'browser' },
      pageRenderer: {
        renderHtml: async (input) => {
          expect(input.url).toContain('https://example.com/app');
          return { finalUrl: 'https://example.com/app', html: rendered };
        },
      },
    });
    expect(result.provider).toBe('browser');
    expect(result.thinContent).toBeUndefined();
    expect(result.text.toLowerCase()).toContain('rendered article');
  });

  it('keeps the thin local extract when the renderer redirects to a private host', async () => {
    const spa =
      '<html><head><title>App</title></head><body><div id="root"></div>' +
      '<script>window.__NEXT_DATA__={}</script></body></html>';
    const result = await webFetch('https://example.com/app', {
      fetchImpl: async () =>
        new Response(spa, { status: 200, headers: { 'content-type': 'text/html' } }),
      resolveHostAddresses: async (hostname) =>
        hostname === 'example.com' ? ['93.184.216.34'] : ['127.0.0.1'],
      config: { fetchBlockedUrlPrefixes: [], fetchFallback: 'browser' },
      pageRenderer: {
        renderHtml: async () => ({
          finalUrl: 'http://internal.local/secret',
          html: '<html><body>should not leak</body></html>',
        }),
      },
    });
    expect(result.provider).toBe('supermarkdown');
    expect(result.thinContent).toBe(true);
    expect(result.text).not.toContain('should not leak');
  });

  it('keeps the thin local extract when the browser renderer is missing', async () => {
    const spa =
      '<html><head><title>App</title></head><body><div id="root"></div>' +
      '<script>window.__NEXT_DATA__={}</script></body></html>';
    const result = await webFetch('https://example.com/app', {
      fetchImpl: async () =>
        new Response(spa, { status: 200, headers: { 'content-type': 'text/html' } }),
      resolveHostAddresses: async () => ['93.184.216.34'],
      config: { fetchBlockedUrlPrefixes: [], fetchFallback: 'browser' },
    });
    expect(result.provider).toBe('supermarkdown');
    expect(result.thinContent).toBe(true);
  });

  it('extracts PDF bytes through the injected document extractor', async () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake');
    const result = await webFetch('https://example.com/report.pdf', {
      fetchImpl: async () =>
        new Response(pdfBytes, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
      resolveHostAddresses: async () => ['93.184.216.34'],
      config: { fetchBlockedUrlPrefixes: [] },
      documentExtractor: {
        extract: async (input) => {
          expect(input.mimeType).toBe('application/pdf');
          expect(input.bytes.byteLength).toBe(pdfBytes.byteLength);
          return { text: 'Hello from the PDF.', title: 'report.pdf', pageCount: 1 };
        },
      },
    });
    expect(result.text).toBe('Hello from the PDF.');
    expect(result.pageCount).toBe(1);
    expect(result.contentType).toContain('application/pdf');
  });

  it('spills the full extract when the returned window has more', async () => {
    const body = 'word '.repeat(80);
    const result = await webFetch('https://example.com/long.txt', {
      fetchImpl: async () =>
        new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } }),
      resolveHostAddresses: async () => ['93.184.216.34'],
      config: {
        fetchBlockedUrlPrefixes: [],
        fetchReturnMaxChars: 40,
        fetchStoreMaxChars: 4000,
      },
      spillStore: {
        write: async ({ text }) => {
          expect(text.length).toBeGreaterThan(40);
          return '/tmp/session/fetch-spills/abcd.txt';
        },
      },
    });
    expect(result.hasMore).toBe(true);
    expect(result.spillPath).toBe('/tmp/session/fetch-spills/abcd.txt');
  });

  it('does not spill when the returned window already covers the page', async () => {
    const write = vi.fn(async () => '/tmp/session/fetch-spills/unused.txt');
    const result = await webFetch('https://example.com/short.txt', {
      fetchImpl: async () =>
        new Response('short page', { status: 200, headers: { 'content-type': 'text/plain' } }),
      resolveHostAddresses: async () => ['93.184.216.34'],
      config: { fetchBlockedUrlPrefixes: [] },
      spillStore: { write },
    });
    expect(result.hasMore).toBe(false);
    expect(result.spillPath).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });

  it('still rejects PDF when no document extractor is injected', async () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.4 fake');
    await expect(
      webFetch('https://example.com/report.pdf', {
        fetchImpl: async () =>
          new Response(pdfBytes, {
            status: 200,
            headers: { 'content-type': 'application/pdf' },
          }),
        resolveHostAddresses: async () => ['93.184.216.34'],
        config: { fetchBlockedUrlPrefixes: [] },
      }),
    ).rejects.toThrow(/unsupported content-type/);
  });
});
