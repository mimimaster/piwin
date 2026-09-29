import { describe, expect, it } from 'vitest';
import { createDefaultWebConfig } from './config.js';
import {
  buildSearchChain,
  DEFAULT_SEARCH_NATIVE_TIMEOUT_MS,
  readWebSearchDiagnostics,
  WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
  type NativeSearchDiagnostic,
  type WebSearchResult,
} from './web.js';

describe('web contracts', () => {
  it('defaults the native sub-request budget to 120s', () => {
    expect(DEFAULT_SEARCH_NATIVE_TIMEOUT_MS).toBe(120_000);
    expect(createDefaultWebConfig().searchNativeTimeoutMs).toBe(120_000);
  });

  it('keeps native result fields optional so legacy sources still type-check', () => {
    const legacy: WebSearchResult = { query: 'q', providerId: 'brave', hits: [] };
    const native: WebSearchResult = {
      query: 'q',
      providerId: 'openai',
      hits: [{ title: 'A', url: 'https://a.example', snippet: '' }],
      answer: 'brief',
      searchQueries: ['q1'],
      citations: [{ url: 'https://a.example' }],
      nativeDiagnostic: {
        providerId: 'openai',
        adapter: 'openai-responses-tool',
        transport: 'pi-tee',
        eventDetected: true,
        hitCount: 1,
        durationMs: 5,
      },
    };
    expect(legacy.answer).toBeUndefined();
    expect(native.nativeDiagnostic?.transport).toBe('pi-tee');
  });

  it('bounds diagnostics read back from tool details', () => {
    const read = readWebSearchDiagnostics({
      kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
      providerId: 'native',
      hitCount: -1,
      durationMs: 3,
      attempts: [{ sourceId: 'native:openai', ok: false, hitCount: 0, durationMs: 1, error: 'x'.repeat(900) }],
    });
    expect(read?.hitCount).toBe(0);
    expect(read?.attempts[0]?.error?.length).toBe(300);
  });
});

describe('native web_search details', () => {
  it('round-trips bounded native details and drops oversized suggestions', () => {
    const read = readWebSearchDiagnostics({
      kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
      providerId: 'native:gemini/g',
      hitCount: 1,
      durationMs: 1,
      attempts: [],
      native: {
        diagnostic: {
          providerId: 'gemini',
          adapter: 'google-search-tool',
          transport: 'gemini-rest',
            eventDetected: true,
          hitCount: 1,
          durationMs: 1,
          query: 'must not survive',
        },
        searchQueries: ['q', 3],
        searchSuggestionsHtml: '<div>chips</div>',
      },
    });
    expect(read?.native?.diagnostic.transport).toBe('gemini-rest');
    expect(JSON.stringify(read)).not.toContain('must not survive');
    expect(read?.native?.searchQueries).toEqual(['q']);
    expect(read?.native?.searchSuggestionsHtml).toBe('<div>chips</div>');
    const huge = readWebSearchDiagnostics({
      kind: WEB_SEARCH_DIAGNOSTICS_DETAILS_KIND,
      providerId: 'x',
      attempts: [],
      native: {
        diagnostic: { providerId: 'g', adapter: 'google-search-tool' },
        searchSuggestionsHtml: 'x'.repeat(70_000),
      },
    });
    expect(huge?.native?.searchSuggestionsHtml).toBeUndefined();
  });
});

describe('buildSearchChain', () => {
  it('native-first with sources is native then sources then DuckDuckGo', () => {
    const chain = buildSearchChain({
      policy: 'native-first',
      nativeReady: true,
      hasEnabledSources: true,
    });
    expect(chain).toEqual(['native', 'sources', 'duckduckgo']);
  });

  it('does not duplicate DuckDuckGo when the user already enabled it', () => {
    expect(
      buildSearchChain({
        policy: 'external-first',
        nativeReady: true,
        hasEnabledSources: true,
        duckduckgoEnabled: true,
      }),
    ).toEqual(['sources', 'native']);
  });

  it('native-only never appends DuckDuckGo', () => {
    expect(
      buildSearchChain({
        policy: 'native-only',
        nativeReady: true,
        hasEnabledSources: true,
      }),
    ).toEqual(['native']);
  });

  it('untagged model still has a DuckDuckGo floor', () => {
    expect(
      buildSearchChain({
        policy: 'native-first',
        nativeReady: false,
        hasEnabledSources: false,
      }),
    ).toEqual(['duckduckgo']);
  });
});
