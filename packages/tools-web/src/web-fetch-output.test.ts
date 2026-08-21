import { describe, expect, it } from 'vitest';
import { formatWebFetchOutput } from './web-fetch-output.js';

describe('formatWebFetchOutput', () => {
  it('emits metadata then a raw body without JSON escaping', () => {
    const output = formatWebFetchOutput({
      url: 'https://example.com/a',
      finalUrl: 'https://example.com/a',
      title: 'Doc',
      text: 'line 1\nline 2',
      contentType: 'text/html',
      byteSize: 12,
      truncated: false,
      totalChars: 12,
      range: { start: 0, end: 12 },
      hasMore: false,
      outline: ['Doc'],
      fromCache: false,
      provider: 'supermarkdown',
      extraction: 'head',
    });
    expect(output).toContain('url: https://example.com/a');
    expect(output).toContain('extraction: head');
    expect(output).toContain('- Doc');
    expect(output).toContain('\n---\nline 1\nline 2');
    expect(output).not.toContain('\\n');
  });

  it('hints that a thin extract may need a JS-capable reader', () => {
    const output = formatWebFetchOutput({
      url: 'https://example.com/app',
      finalUrl: 'https://example.com/app',
      title: 'App',
      text: 'Loading',
      contentType: 'text/html',
      byteSize: 8,
      truncated: false,
      provider: 'supermarkdown',
      extraction: 'head',
      thinContent: true,
    });
    expect(output).toContain('thinContent: true');
    expect(output).toContain('fetchFallback=jina');
  });

  it('points the model at spillPath for the full extract', () => {
    const output = formatWebFetchOutput({
      url: 'https://example.com/long',
      finalUrl: 'https://example.com/long',
      title: 'Long',
      text: 'head',
      contentType: 'text/plain',
      byteSize: 4,
      truncated: false,
      hasMore: true,
      spillPath: '/tmp/session/fetch-spills/abcd.txt',
    });
    expect(output).toContain('spillPath: /tmp/session/fetch-spills/abcd.txt');
    expect(output).toContain('read_file or grep');
  });
});
