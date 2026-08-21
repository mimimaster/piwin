import { describe, expect, it } from 'vitest';
import { parseToolCitations } from './tool-citations';

describe('parseToolCitations', () => {
  it('parses web_search hits', () => {
    const parsed = parseToolCitations(
      'web_search',
      JSON.stringify({
        query: 'piwin',
        providerId: 'brave',
        hits: [{ title: 'Piwin', url: 'https://example.com', snippet: 'hello' }],
      }),
    );
    expect(parsed.kind).toBe('web_search');
    expect(parsed.citations).toHaveLength(1);
    expect(parsed.citations[0]?.url).toBe('https://example.com');
  });

  it('parses web_fetch plain metadata output', () => {
    const parsed = parseToolCitations(
      'web_fetch',
      [
        'url: https://example.com/a',
        'finalUrl: https://example.com/a',
        'title: Doc',
        'truncated: false',
        '',
        '---',
        'Body text here',
      ].join('\n'),
    );
    expect(parsed.kind).toBe('web_fetch');
    expect(parsed.citations[0]?.title).toBe('Doc');
    expect(parsed.fetchPreview?.excerpt).toContain('Body');
  });

  it('parses web_fetch result', () => {
    const parsed = parseToolCitations(
      'web_fetch',
      JSON.stringify({
        url: 'https://example.com/a',
        finalUrl: 'https://example.com/a',
        title: 'Doc',
        text: 'Body text here',
        truncated: false,
      }),
    );
    expect(parsed.kind).toBe('web_fetch');
    expect(parsed.citations[0]?.title).toBe('Doc');
    expect(parsed.fetchPreview?.excerpt).toContain('Body');
  });

  it('returns none for plain tool output', () => {
    expect(parseToolCitations('bash', 'not json').kind).toBe('none');
  });
});
