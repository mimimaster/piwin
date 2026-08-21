import { describe, expect, it } from 'vitest';
import { FETCH_THIN_HTML_CHARS } from './fetch-caps.js';
import { detectThinContent, looksLikeSpaShell } from './fetch-thin.js';

describe('detectThinContent', () => {
  it('flags a large HTML shell with almost no extracted text', () => {
    expect(detectThinContent('Loading…', 'x'.repeat(FETCH_THIN_HTML_CHARS + 1))).toBe(true);
  });

  it('flags a small SPA shell even when HTML is under the size cap', () => {
    const html = '<div id="root"></div><script>window.__NEXT_DATA__={}</script>';
    expect(looksLikeSpaShell(html)).toBe(true);
    expect(detectThinContent('App', html)).toBe(true);
  });

  it('does not flag a normal article', () => {
    const text = 'A'.repeat(900);
    expect(detectThinContent(text, '<article><p>hello</p></article>')).toBe(false);
  });
});
