import { describe, expect, it } from 'vitest';
import type { WebSearchResult } from '@piwin/contracts';
import { createWebToolDefinitions, formatWebSearchOutput } from './tool-definitions.js';

const nativeResult: WebSearchResult = {
  query: 'q',
  providerId: 'native:p/m',
  hits: [{ title: 'Delegated', url: 'https://example.com/delegated', snippet: '' }],
  answer: 'Grounded brief [1].',
};

describe('web_search tool definition', () => {
  it('formats a native answer as untrusted data with numbered sources', () => {
    const output = JSON.parse(formatWebSearchOutput(nativeResult)) as Record<string, unknown>;
    expect(output.note).toMatch(/untrusted/u);
    expect(output.numberedSources).toEqual(['[1] Delegated — https://example.com/delegated']);
    expect(output.hits).toHaveLength(1);
    const plain = JSON.parse(formatWebSearchOutput({ query: 'q', providerId: 'x', hits: [] })) as Record<string, unknown>;
    expect(plain.note).toBeUndefined();
  });

  it('still registers web_search and web_fetch', () => {
    expect(createWebToolDefinitions().map((tool) => tool.descriptor.name)).toEqual(['web_search', 'web_fetch']);
  });
});

describe('web_search log fields', () => {
  it('summarizes native details without HTML or issued query texts', async () => {
    const { logFields } = await import('./tool-definitions.js');
    const fields = logFields({
      kind: 'web-search-diagnostics',
      providerId: 'native:gemini/g',
      hitCount: 1,
      durationMs: 5,
      attempts: [{ sourceId: 'native:gemini/g', ok: true, hitCount: 1, durationMs: 5 }],
      native: {
        diagnostic: {
          providerId: 'gemini',
          adapter: 'google-search-tool',
          transport: 'gemini-rest',
          eventDetected: true,
          hitCount: 1,
          durationMs: 5,
        },
        searchQueries: ['secret issued query'],
        searchSuggestionsHtml: '<div>chips</div>',
      },
    });
    expect(fields.native).toEqual({
      providerId: 'gemini',
      adapter: 'google-search-tool',
      transport: 'gemini-rest',
      eventDetected: true,
      searchQueryCount: 1,
    });
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain('chips');
    expect(serialized).not.toContain('secret issued query');
    expect('kind' in fields).toBe(false);
  });

  it('records the native summary through the web_search tool sink on fallback', async () => {
    const records: import('@piwin/contracts').WebSearchLogRecord[] = [];
    const delegate = {
      model: { protocol: 'google-gemini' as const, providerId: 'gemini', modelId: 'g' },
      search: async () => {
        throw Object.assign(new Error('native boom'), {
          diagnostic: {
            providerId: 'gemini',
            adapter: 'google-search-tool',
            transport: 'gemini-rest',
            eventDetected: false,
            hitCount: 0,
            durationMs: 1,
            error: 'native boom',
          },
        });
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://t.example/', content: 'x' }] }), {
        status: 200,
      })) as typeof fetch;
    process.env.PIWIN_TEST_TAVILY_KEY = 'k';
    try {
      const tools = createWebToolDefinitions(
        {
          searchRoutePolicy: 'native-first',
          searchSources: [{ id: 'tavily', kind: 'tavily', enabled: true, apiKeyEnv: 'PIWIN_TEST_TAVILY_KEY' }],
        },
        {},
        delegate,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { record: (entry) => records.push(entry) },
      );
      const search = tools.find((tool) => tool.descriptor.name === 'web_search');
      const context = { sessionId: 's1', runtimeGenerationId: 'g1', runId: 'r1', toolName: 'web_search' };
      const result = await search?.execute({ query: 'q' }, new AbortController().signal, context);
      expect(result?.ok).toBe(true);
      expect(records[0]?.attempts.map((attempt) => attempt.ok)).toEqual([false, true]);
      expect(records[0]?.native).toMatchObject({
        adapter: 'google-search-tool',
        fellBackToSources: true,
        eventDetected: false,
        error: 'native boom',
      });
    } finally {
      globalThis.fetch = originalFetch;
      delete process.env.PIWIN_TEST_TAVILY_KEY;
    }
  });
});
