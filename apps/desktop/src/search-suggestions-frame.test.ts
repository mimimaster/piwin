import { describe, expect, it } from 'vitest';
import { buildSearchSuggestionsDocument, isGoogleSearchUrl } from './search-suggestions-frame';

describe('Gemini Search Suggestions frame', () => {
  it('embeds Google HTML verbatim under a script-free CSP', () => {
    const html = '<style>.c{color:red}</style><div class="c"><a href="https://www.google.com/search?q=x">x</a></div>';
    const doc = buildSearchSuggestionsDocument(html);
    expect(doc).toContain(html);
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toContain('script-src');
  });

  it('only routes Google result pages', () => {
    expect(isGoogleSearchUrl('https://www.google.com/search?q=x')).toBe(true);
    expect(isGoogleSearchUrl('https://www.google.co.jp/search?q=x')).toBe(true);
    expect(isGoogleSearchUrl('http://www.google.com/search?q=x')).toBe(false);
    expect(isGoogleSearchUrl('https://evil.example/?google.com')).toBe(false);
    expect(isGoogleSearchUrl('javascript:alert(1)')).toBe(false);
  });
});
