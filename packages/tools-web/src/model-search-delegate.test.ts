import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModelRef, WebSearchResult } from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import type { WebSearchModelDelegate } from './model-search-delegate.js';
import { webSearch, WebSearchError, webSearchWithDiagnostics } from './search-provider.js';

const delegateModel: ModelRef = {
  protocol: 'google-gemini',
  providerId: 'gemini',
  modelId: 'gemini-search',
};

const nativeResult: WebSearchResult = {
  query: 'current result',
  providerId: 'gemini',
  hits: [{ title: 'Delegated', url: 'https://example.com/delegated', snippet: '' }],
  answer: 'Grounded brief [1].',
  searchQueries: ['issued query'],
  searchSuggestionsHtml: '<div>chips</div>',
  nativeDiagnostic: {
    providerId: 'gemini',
    adapter: 'google-search-tool',
    transport: 'gemini-rest',
    eventDetected: true,
    hitCount: 1,
    durationMs: 4,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('native web_search executor', () => {
  it('runs the native executor, keeps suggestions/diagnostic out of model output', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const search = vi.fn<WebSearchModelDelegate['search']>(async () => nativeResult);
    const { result, diagnostics } = await webSearchWithDiagnostics(
      'current result',
      createDefaultWebConfig(),
      undefined,
      {},
      { model: delegateModel, search },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith('current result', expect.objectContaining({ limit: 10 }));
    expect(result.providerId).toBe('native:gemini/gemini-search');
    expect(result.answer).toBe('Grounded brief [1].');
    expect(result.searchSuggestionsHtml).toBeUndefined();
    expect(result.nativeDiagnostic).toBeUndefined();
    expect(diagnostics.native?.diagnostic.transport).toBe('gemini-rest');
    expect(diagnostics.native?.searchSuggestionsHtml).toBe('<div>chips</div>');
    expect(diagnostics.native?.searchQueries).toEqual(['issued query']);
  });

  it('native-first falls back inside the same call, with both attempts visible', async () => {
    vi.stubGlobal('fetch', (async () =>
      new Response(
        JSON.stringify({ Results: [], RelatedTopics: [{ FirstURL: 'https://ddg.example/a', Text: 'A - text' }] }),
        { status: 200 },
      )) as typeof fetch);
    const search = vi.fn<WebSearchModelDelegate['search']>(async () => {
      throw Object.assign(new Error('provider 400'), {
        diagnostic: { ...nativeResult.nativeDiagnostic, eventDetected: false, hitCount: 0, error: 'provider 400' },
      });
    });
    const { diagnostics } = await webSearchWithDiagnostics(
      'q',
      createDefaultWebConfig(),
      undefined,
      {},
      { model: delegateModel, search },
    );
    expect(diagnostics.attempts[0]).toMatchObject({ sourceId: 'native:gemini/gemini-search', ok: false });
    expect(diagnostics.attempts.length).toBeGreaterThan(1);
    expect(diagnostics.native?.fellBackToSources).toBe(true);
    expect(search).toHaveBeenCalledOnce();
  });

  it('treats an empty native result as a failed step and continues the chain', async () => {
    vi.stubGlobal('fetch', (async () =>
      new Response(
        JSON.stringify({ Results: [], RelatedTopics: [{ FirstURL: 'https://ddg.example/a', Text: 'A - text' }] }),
        { status: 200 },
      )) as typeof fetch);
    const search = vi.fn<WebSearchModelDelegate['search']>(async () => ({
      query: 'q',
      providerId: 'gemini',
      hits: [],
      warning: 'Native search transport exposed no response body; sources are unavailable.',
    }));
    const { result, diagnostics } = await webSearchWithDiagnostics(
      'q',
      createDefaultWebConfig(),
      undefined,
      {},
      { model: delegateModel, search },
    );
    expect(diagnostics.attempts[0]).toMatchObject({
      sourceId: 'native:gemini/gemini-search',
      ok: false,
      error: expect.stringContaining('no response body'),
    });
    expect(result.hits.map((hit) => hit.url)).toContain('https://ddg.example/a');
  });

  it('reports the native failure alongside a failed DuckDuckGo floor', async () => {
    vi.stubGlobal('fetch', (async () => new Response('', { status: 202 })) as typeof fetch);
    const search = vi.fn<WebSearchModelDelegate['search']>(async () => {
      throw new Error('Native web search failed: fetch failed');
    });
    const error = await webSearch('q', createDefaultWebConfig(), undefined, {}, {
      model: delegateModel,
      search,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WebSearchError);
    const message = (error as WebSearchError).message;
    expect(message).toContain('native:gemini/gemini-search: Native web search failed: fetch failed');
    expect(message).toMatch(/duckduckgo: .*202/);
  });

  it('native-only surfaces the native failure without any fallback', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const search = vi.fn<WebSearchModelDelegate['search']>(async () => {
      throw new Error('boom');
    });
    const nativeOnly = { ...createDefaultWebConfig(), searchRoutePolicy: 'native-only' as const };
    const error = await webSearch('q', nativeOnly, undefined, {}, { model: delegateModel, search }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(WebSearchError);
    expect((error as WebSearchError).diagnostics.attempts).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
