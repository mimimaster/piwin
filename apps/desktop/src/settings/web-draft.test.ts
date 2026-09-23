import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FETCH_CACHE_TTL_MS,
  DEFAULT_FETCH_RETURN_MAX_CHARS,
  DEFAULT_FETCH_STORE_MAX_CHARS,
  type WebConfig,
} from '@piwin/contracts';
import {
  createDraftSearchSource,
  draftToWeb,
  preserveWebCliLaunchers,
  webToDraft,
  type DraftWeb,
} from './web-draft';

const SAMPLE_WEB: WebConfig = {
  searchProvider: 'aggregate',
  searchApiKeyEnv: 'BRAVE_API_KEY',
  searchMaxResults: 8,
  searchTimeoutMs: 12000,
  searchSources: [
    { id: 'duckduckgo', kind: 'duckduckgo', enabled: true },
    {
      id: 'brave',
      kind: 'brave',
      enabled: true,
      apiKeyEnv: 'BRAVE_API_KEY',
      apiKeyRef: 'keychain:piwin-web-brave',
    },
  ],
  searchDelegateModel: {
    protocol: 'google-gemini',
    providerId: 'gemini',
    modelId: 'gemini-search',
  },
  fetchDelegateModel: {
    protocol: 'openai-compatible',
    providerId: 'local',
    modelId: 'small-extract',
  },
  searchStrategy: { mode: 'parallel', perSourceTimeoutMs: 7000 },
  searchRoutePolicy: 'native-first',
  fetchProvider: 'firecrawl',
  fetchFallback: 'none',
  fetchApiKeyRef: 'keychain:piwin-web-fetch-firecrawl',
  fetchApiKeyEnv: 'FIRECRAWL_API_KEY',
  fetchMaxBytes: 32768,
  fetchReturnMaxChars: DEFAULT_FETCH_RETURN_MAX_CHARS,
  fetchStoreMaxChars: DEFAULT_FETCH_STORE_MAX_CHARS,
  fetchCacheTtlMs: DEFAULT_FETCH_CACHE_TTL_MS,
  fetchTimeoutMs: 20000,
  fetchBlockedUrlPrefixes: ['http://internal', 'http://10.'],
};

describe('web draft conversion', () => {
  it('keeps the Host CLI command when a remote draft omitted it', () => {
    const previous: WebConfig = {
      ...SAMPLE_WEB,
      searchSources: [
        {
          id: 'cli',
          kind: 'cli',
          enabled: true,
          command: '/usr/bin/node',
          args: ['/tmp/search.mjs', '{{query}}'],
        },
      ],
    };
    const stripped = draftToWeb(
      webToDraft({
        ...previous,
        searchSources: [{ id: 'cli', kind: 'cli', enabled: true }],
      }),
    );
    expect(stripped.searchSources[0]?.command).toBeUndefined();
    expect(preserveWebCliLaunchers(stripped, previous).searchSources[0]).toMatchObject({
      command: '/usr/bin/node',
      args: ['/tmp/search.mjs', '{{query}}'],
    });
  });

  it('survives a remote Settings projection that omitted fetchApiKeyEnv', () => {
    const { fetchApiKeyEnv: _omitted, fetchApiKeyRef: _ref, ...sparse } = SAMPLE_WEB;
    const parsed = draftToWeb(webToDraft(sparse as WebConfig));
    expect(parsed.fetchApiKeyEnv).toBe('FIRECRAWL_API_KEY');
    expect(parsed.fetchApiKeyRef).toBeUndefined();
  });

  it('round-trips config → draft → config', () => {
    expect(draftToWeb(webToDraft(SAMPLE_WEB))).toEqual(SAMPLE_WEB);
  });

  it('round-trips the native-vs-external route policy', () => {
    const draft = webToDraft({ ...SAMPLE_WEB, searchRoutePolicy: 'native-only' });
    expect(draft.searchRoutePolicy).toBe('native-only');
    expect(draftToWeb(draft).searchRoutePolicy).toBe('native-only');
  });

  it('round-trips the optional web_search delegate model', () => {
    const draft = webToDraft(SAMPLE_WEB);
    expect(draft.searchDelegateModel).toEqual(SAMPLE_WEB.searchDelegateModel);
    expect(draftToWeb(draft).searchDelegateModel).toEqual(SAMPLE_WEB.searchDelegateModel);
    delete draft.searchDelegateModel;
    expect(draftToWeb(draft).searchDelegateModel).toBeUndefined();
  });

  it('round-trips the optional web_fetch extract model', () => {
    const draft = webToDraft(SAMPLE_WEB);
    expect(draft.fetchDelegateModel).toEqual(SAMPLE_WEB.fetchDelegateModel);
    expect(draftToWeb(draft).fetchDelegateModel).toEqual(SAMPLE_WEB.fetchDelegateModel);
    delete draft.fetchDelegateModel;
    expect(draftToWeb(draft).fetchDelegateModel).toBeUndefined();
  });

  it('uses external-first when loading a legacy Web config without a route policy', () => {
    const legacy: Partial<typeof SAMPLE_WEB> = { ...SAMPLE_WEB };
    delete legacy.searchRoutePolicy;
    expect(webToDraft(legacy as typeof SAMPLE_WEB).searchRoutePolicy).toBe('external-first');
    expect(draftToWeb(webToDraft(legacy as typeof SAMPLE_WEB)).searchRoutePolicy).toBe(
      'external-first',
    );
  });

  it('round-trips fetchFallback', () => {
    const config: WebConfig = { ...SAMPLE_WEB, fetchFallback: 'jina' };
    expect(draftToWeb(webToDraft(config)).fetchFallback).toBe('jina');
    expect(draftToWeb(webToDraft({ ...SAMPLE_WEB, fetchFallback: 'browser' })).fetchFallback).toBe(
      'browser',
    );
  });

  it('fills progressive fetch caps when a legacy Web config omits them', () => {
    const { fetchReturnMaxChars, fetchStoreMaxChars, fetchCacheTtlMs, ...legacy } = SAMPLE_WEB;
    void fetchReturnMaxChars;
    void fetchStoreMaxChars;
    void fetchCacheTtlMs;
    const parsed = draftToWeb(webToDraft(legacy as WebConfig));
    expect(parsed.fetchReturnMaxChars).toBe(DEFAULT_FETCH_RETURN_MAX_CHARS);
    expect(parsed.fetchStoreMaxChars).toBe(DEFAULT_FETCH_STORE_MAX_CHARS);
    expect(parsed.fetchCacheTtlMs).toBe(DEFAULT_FETCH_CACHE_TTL_MS);
  });

  it('round-trips progressive fetch caps when present', () => {
    const config: WebConfig = {
      ...SAMPLE_WEB,
      fetchReturnMaxChars: 12000,
      fetchStoreMaxChars: 80000,
      fetchCacheTtlMs: 600000,
    };
    expect(draftToWeb(webToDraft(config))).toEqual(config);
  });

  it('renders numbers and prefixes as editable strings', () => {
    const draft = webToDraft(SAMPLE_WEB);
    expect(draft.searchMaxResults).toBe('8');
    expect(draft.fetchMaxBytes).toBe('32768');
    expect(draft.fetchTimeoutMs).toBe('20000');
    expect(draft.fetchBlockedUrlPrefixes).toBe('http://internal, http://10.');
    expect(draft.searchSources).toHaveLength(2);
  });

  it('falls back to defaults for invalid numeric input', () => {
    const invalid: DraftWeb = {
      ...webToDraft(SAMPLE_WEB),
      searchMaxResults: 'abc',
      fetchMaxBytes: '-3',
      fetchTimeoutMs: '',
      searchTimeoutMs: 'nope',
      perSourceTimeoutMs: '',
    };
    const parsed = draftToWeb(invalid);
    expect(parsed.searchMaxResults).toBe(10);
    expect(parsed.fetchMaxBytes).toBe(65536);
    expect(parsed.fetchTimeoutMs).toBe(15000);
    expect(parsed.searchTimeoutMs).toBe(15000);
    expect(parsed.searchStrategy.perSourceTimeoutMs).toBe(8000);
  });

  it('floors fractional numeric input', () => {
    const fractional: DraftWeb = {
      ...webToDraft(SAMPLE_WEB),
      searchMaxResults: '7.9',
    };
    expect(draftToWeb(fractional).searchMaxResults).toBe(7);
  });

  it('trims and drops empty blocked prefixes', () => {
    const draft: DraftWeb = {
      ...webToDraft(SAMPLE_WEB),
      fetchBlockedUrlPrefixes: ' a , , b ,',
    };
    expect(draftToWeb(draft).fetchBlockedUrlPrefixes).toEqual(['a', 'b']);
  });

  it('defaults empty fetch api key env to FIRECRAWL_API_KEY', () => {
    const draft: DraftWeb = {
      ...webToDraft(SAMPLE_WEB),
      fetchApiKeyEnv: '   ',
    };
    expect(draftToWeb(draft).fetchApiKeyEnv).toBe('FIRECRAWL_API_KEY');
  });

  it('mirrors searchProvider none when all sources disabled', () => {
    const draft = webToDraft(SAMPLE_WEB);
    draft.searchSources = draft.searchSources.map((source) => ({
      ...source,
      enabled: false,
    }));
    expect(draftToWeb(draft).searchProvider).toBe('none');
  });

  it('creates a devin search source bound to the subscription secret', () => {
    const source = createDraftSearchSource('devin', []);
    expect(source.kind).toBe('devin');
    expect(source.id).toBe('devin');
    expect(source.apiKeyRef).toBe('oauth:devin');
    expect(source.apiKeyEnv).toBe('');
    expect(source.baseUrl).toBe('');
  });

  it('creates unique draft source ids', () => {
    const first = createDraftSearchSource('tavily', []);
    const second = createDraftSearchSource('tavily', [first.id]);
    expect(first.id).toBe('tavily');
    expect(second.id).toBe('tavily-2');
  });

  it('round-trips CLI env lines', () => {
    const config: WebConfig = {
      ...SAMPLE_WEB,
      searchProvider: 'cli',
      searchApiKeyEnv: '',
      searchSources: [
        {
          id: 'cli',
          kind: 'cli',
          enabled: true,
          command: 'my-search',
          args: ['{{query}}'],
          env: { SEARCH_API_KEY: 'from-env' },
        },
      ],
    };
    expect(draftToWeb(webToDraft(config))).toEqual(config);
  });

  it('parses CLI args as one token per line', () => {
    const draft = webToDraft(SAMPLE_WEB);
    const cliSource = createDraftSearchSource('cli', []);
    draft.searchSources = [
      {
        ...cliSource,
        command: 'smart-search',
        args: 'search\n--format json\n{{query}}',
      },
    ];
    const parsed = draftToWeb(draft);
    expect(parsed.searchSources[0]).toMatchObject({
      kind: 'cli',
      command: 'smart-search',
      args: ['search', '--format json', '{{query}}'],
    });
  });

  it('round-trips multi-token CLI args through draft', () => {
    const config: WebConfig = {
      ...SAMPLE_WEB,
      searchProvider: 'cli',
      searchApiKeyEnv: '',
      searchSources: [
        {
          id: 'cli',
          kind: 'cli',
          enabled: true,
          command: 'my-search',
          args: ['--q', '{{query}}', '--limit', '5'],
        },
      ],
    };
    expect(draftToWeb(webToDraft(config))).toEqual(config);
  });

  it('keeps keychain references while excluding raw secrets from config drafts', () => {
    const draft = webToDraft(SAMPLE_WEB);
    expect(draft.searchSources[1]?.apiKeyRef).toBe('keychain:piwin-web-brave');
    expect(draft.fetchApiKeyRef).toBe('keychain:piwin-web-fetch-firecrawl');
    expect(JSON.stringify(draft)).not.toContain('raw-secret');
  });
});
