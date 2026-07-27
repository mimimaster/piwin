import { describe, expect, it } from 'vitest';
import type { WebConfig } from '@piwin/contracts';
import { draftToWeb, webToDraft, type DraftWeb } from './web-draft';

const SAMPLE_WEB: WebConfig = {
  searchProvider: 'brave',
  searchApiKeyEnv: 'BRAVE_API_KEY',
  searchMaxResults: 8,
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
  });

  it('falls back to defaults for invalid numeric input', () => {
    const invalid: DraftWeb = {
      ...webToDraft(SAMPLE_WEB),
      searchMaxResults: 'abc',
      fetchMaxBytes: '-3',
      fetchTimeoutMs: '',
    };
    const parsed = draftToWeb(invalid);
    expect(parsed.searchMaxResults).toBe(5);
    expect(parsed.fetchMaxBytes).toBe(65536);
    expect(parsed.fetchTimeoutMs).toBe(15000);
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
});
