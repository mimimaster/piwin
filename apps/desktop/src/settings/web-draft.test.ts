import { describe, expect, it } from 'vitest';
import type { WebConfig } from '@piwin/contracts';
import {
  createDraftSearchSource,
  draftToWeb,
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
    },
  ],
  searchStrategy: { mode: 'parallel', perSourceTimeoutMs: 7000 },
  fetchProvider: 'firecrawl',
  fetchApiKeyEnv: 'FIRECRAWL_API_KEY',
  fetchMaxBytes: 32768,
  fetchTimeoutMs: 20000,
  fetchBlockedUrlPrefixes: ['http://internal', 'http://10.'],
};

describe('web draft conversion', () => {
  it('round-trips config → draft → config', () => {
    expect(draftToWeb(webToDraft(SAMPLE_WEB))).toEqual(SAMPLE_WEB);
  });

  it('renders numbers and prefixes as editable strings', () => {
    const draft = webToDraft(SAMPLE_WEB);
    expect(draft.searchMaxResults).toBe('8');
    expect(draft.fetchMaxBytes).toBe('32768');
    expect(draft.fetchTimeoutMs).toBe('20000');
    expect(draft.fetchBlockedUrlPrefixes).toBe('http://internal, http://10.');
    expect(draft.searchSources).toHaveLength(2);
    expect(draft.searchStrategyMode).toBe('parallel');
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

  it('creates unique draft source ids', () => {
    const first = createDraftSearchSource('tavily', []);
    const second = createDraftSearchSource('tavily', [first.id]);
    expect(first.id).toBe('tavily');
    expect(second.id).toBe('tavily-2');
  });
});
