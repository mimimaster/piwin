import { describe, expect, it } from 'vitest';
import { selectFetchView } from './fetch-view.js';
import type { FetchStoreRecord } from './fetch-cache.js';
import type { ResolvedFetchCaps } from './fetch-caps.js';

const stored: FetchStoreRecord = {
  url: 'https://example.com/doc',
  finalUrl: 'https://example.com/doc',
  title: 'Doc',
  text: 'abcdefghijklmnopqrstuvwxyz',
  contentType: 'text/html',
  byteSize: 26,
  truncated: false,
  outline: ['Intro', 'API'],
  provider: 'supermarkdown',
};

const caps: ResolvedFetchCaps = {
  storeMaxChars: 100,
  returnMaxChars: 10,
  bodyMaxBytes: 400,
  parseMaxChars: 200,
  cacheTtlMs: 900_000,
};

describe('selectFetchView', () => {
  it('returns a head window with continuation metadata', () => {
    const view = selectFetchView(stored, {}, caps, false);
    expect(view.text).toBe('abcdefghij');
    expect(view.extraction).toBe('head');
    expect(view.range).toEqual({ start: 0, end: 10 });
    expect(view.hasMore).toBe(true);
    expect(view.nextOffset).toBe(10);
    expect(view.outline).toEqual(['Intro', 'API']);
    expect(view.fromCache).toBe(false);
  });

  it('continues from offset', () => {
    const view = selectFetchView(stored, { offset: 10 }, caps, true);
    expect(view.text).toBe('klmnopqrst');
    expect(view.extraction).toBe('offset');
    expect(view.fromCache).toBe(true);
    expect(view.nextOffset).toBe(20);
  });

  it('returns only the outline when requested', () => {
    const view = selectFetchView(stored, { outline: true }, caps, true);
    expect(view.extraction).toBe('outline');
    expect(view.text).toBe('- Intro\n- API');
    expect(view.hasMore).toBe(true);
    expect(view.nextOffset).toBe(0);
  });
});
