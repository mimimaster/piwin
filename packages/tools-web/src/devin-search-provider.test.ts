import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebSearchSource } from '@piwin/contracts';
import { createDevinProvider } from './devin-search-provider.js';

const SOURCE: WebSearchSource = { id: 'devin-main', kind: 'devin', enabled: true };

const PRIMARY = 'https://server.codeium.com/exa.api_server_pb.ApiServerService/GetWebSearchResults';
const FALLBACK =
  'https://server.self-serve.windsurf.com/exa.api_server_pb.ApiServerService/GetWebSearchResults';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WINDSURF_API_KEY;
  delete process.env.DEVIN_TEST_KEY;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readBody(init?: RequestInit): {
  metadata?: { apiKey?: string; ideName?: string };
  query?: string;
  limit?: number;
} {
  return JSON.parse(String(init?.body ?? '{}')) as {
    metadata?: { apiKey?: string; ideName?: string };
    query?: string;
    limit?: number;
  };
}

describe('createDevinProvider', () => {
  it('posts to codeium with a prefixed session token and a clamped limit', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    vi.stubGlobal('fetch', (async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return jsonResponse({
        results: [
          { title: 'Piwin', url: 'https://example.com/piwin', snippet: 'agent host' },
          { title: '', url: 'https://example.com/drop', snippet: 'no title' },
          { url: 'https://example.com/also-drop', snippet: 'no title field' },
        ],
      });
    }) as typeof fetch);

    const hits = await createDevinProvider(SOURCE, 'raw-token').search('  windsurf  ', { limit: 50 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(PRIMARY);
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['Connect-Protocol-Version']).toBe('1');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Accept).toBe('application/json');
    expect(headers['User-Agent']).toBe('windsurf/1.9600.41');
    expect(calls[0]?.init?.method).toBe('POST');
    const body = readBody(calls[0]?.init);
    expect(body.metadata?.apiKey).toBe('raw-token');
    expect(body.metadata?.ideName).toBe('windsurf');
    expect(body.query).toBe('windsurf');
    expect(body.limit).toBe(10);
    expect(hits).toEqual([
      {
        title: 'Piwin',
        url: 'https://example.com/piwin',
        snippet: 'agent host',
        source: 'devin-main',
      },
    ]);
  });

  it('sends a legacy sk-ws key unchanged', async () => {
    let apiKey = '';
    vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
      apiKey = readBody(init).metadata?.apiKey ?? '';
      return jsonResponse({ results: [{ name: 'Alias', webUrl: 'https://example.com/a', summary: 's' }] });
    }) as typeof fetch);

    const hits = await createDevinProvider(SOURCE, 'sk-ws-legacy').search('q', { limit: 1 });
    expect(apiKey).toBe('sk-ws-legacy');
    expect(hits).toEqual([
      { title: 'Alias', url: 'https://example.com/a', snippet: 's', source: 'devin-main' },
    ]);
  });

  it('keeps an already-prefixed token and reads WINDSURF_API_KEY', async () => {
    process.env.WINDSURF_API_KEY = 'devin-session-token$from-env';
    let apiKey = '';
    vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
      apiKey = readBody(init).metadata?.apiKey ?? '';
      return jsonResponse({ results: [] });
    }) as typeof fetch);

    await createDevinProvider(SOURCE).search('q', { limit: 1 });
    expect(apiKey).toBe('devin-session-token$from-env');
  });

  it('prefers the source apiKeyEnv over WINDSURF_API_KEY', async () => {
    process.env.WINDSURF_API_KEY = 'from-default';
    process.env.DEVIN_TEST_KEY = 'from-source-env';
    let apiKey = '';
    vi.stubGlobal('fetch', (async (_input: unknown, init?: RequestInit) => {
      apiKey = readBody(init).metadata?.apiKey ?? '';
      return jsonResponse({ results: [] });
    }) as typeof fetch);

    await createDevinProvider({ ...SOURCE, apiKeyEnv: 'DEVIN_TEST_KEY' }).search('q', { limit: 1 });
    expect(apiKey).toBe('from-source-env');
  });

  it('throws when no key is available', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(createDevinProvider(SOURCE).search('q', { limit: 1 })).rejects.toThrow(
      'Missing Devin API key (oauth:devin or WINDSURF_API_KEY)',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries the fallback host after a primary 500', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url === PRIMARY) {
        return jsonResponse({ message: 'unavailable' }, 500);
      }
      return jsonResponse({
        results: [{ title: 'Fallback', url: 'https://example.com/fb', snippet: 'ok' }],
      });
    }) as typeof fetch);

    const hits = await createDevinProvider(SOURCE, 'tok').search('q', { limit: 3 });
    expect(urls).toEqual([PRIMARY, FALLBACK]);
    expect(hits).toEqual([
      { title: 'Fallback', url: 'https://example.com/fb', snippet: 'ok', source: 'devin-main' },
    ]);
  });

  it('retries the fallback host after a primary network error', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url === PRIMARY) {
        throw new TypeError('fetch failed');
      }
      return jsonResponse({
        results: [{ title: 'Fallback', url: 'https://example.com/net', snippet: 'ok' }],
      });
    }) as typeof fetch);

    const hits = await createDevinProvider(SOURCE, 'tok').search('q', { limit: 1 });
    expect(urls).toEqual([PRIMARY, FALLBACK]);
    expect(hits[0]?.url).toBe('https://example.com/net');
  });

  it('tries the fallback host after a primary 401, matching windsurf-search.mjs', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url === PRIMARY) {
        return jsonResponse({ message: 'unauthorized' }, 401);
      }
      return jsonResponse({
        results: [{ title: 'Fallback', url: 'https://example.com/auth', snippet: 'ok' }],
      });
    }) as typeof fetch);

    const hits = await createDevinProvider(SOURCE, 'bad').search('q', { limit: 1 });
    expect(urls).toEqual([PRIMARY, FALLBACK]);
    expect(hits[0]?.url).toBe('https://example.com/auth');
  });

  it('rejects an empty query before calling the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(createDevinProvider(SOURCE, 'tok').search('   ', { limit: 1 })).rejects.toThrow(
      /empty/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not hide an aborted request behind the fallback host', async () => {
    const urls: string[] = [];
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', (async (input: unknown) => {
      urls.push(String(input));
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as typeof fetch);

    await expect(
      createDevinProvider(SOURCE, 'tok').search('q', { limit: 1, signal: controller.signal }),
    ).rejects.toThrow(/abort/i);
    expect(urls).toEqual([PRIMARY]);
  });
});
