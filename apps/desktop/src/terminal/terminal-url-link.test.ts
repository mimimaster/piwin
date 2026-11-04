import { describe, expect, it } from 'vitest';
import { findTerminalUrls } from './terminal-url-link';

describe('findTerminalUrls', () => {
  it('finds plain URLs and reports their cells', () => {
    const text = 'built in 1.2s → https://example.com/build/42 done';
    const url = 'https://example.com/build/42';
    const start = text.indexOf(url);
    expect(findTerminalUrls(text)).toEqual([{ start, end: start + url.length, text: url }]);
  });

  it('drops the punctuation a sentence adds', () => {
    expect(findTerminalUrls('see (https://a.dev/x).').map((url) => url.text))
      .toEqual(['https://a.dev/x']);
    expect(findTerminalUrls('open https://a.dev/y,').map((url) => url.text))
      .toEqual(['https://a.dev/y']);
    expect(findTerminalUrls('"https://a.dev/z"').map((url) => url.text))
      .toEqual(['https://a.dev/z']);
  });

  it('keeps a paren the URL opened itself', () => {
    expect(findTerminalUrls('https://en.wikipedia.org/wiki/Foo_(bar)').map((url) => url.text))
      .toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
    // Balanced inside the row, so the trailing paren survives.
    expect(findTerminalUrls('(https://a.dev/x_(y))').map((url) => url.text))
      .toEqual(['https://a.dev/x_(y)']);
  });

  it('finds several links on one row', () => {
    expect(findTerminalUrls('http://a.dev and https://b.dev').map((url) => url.text))
      .toEqual(['http://a.dev', 'https://b.dev']);
  });

  it('ignores schemes and bare schemes', () => {
    expect(findTerminalUrls('https://')).toEqual([]);
    expect(findTerminalUrls('ftp://a.dev mailto:a@b.dev file:///tmp/x')).toEqual([]);
    expect(findTerminalUrls('no links here')).toEqual([]);
  });
});
