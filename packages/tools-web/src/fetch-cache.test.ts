import { describe, expect, it } from 'vitest';
import { FetchCache, normalizeFetchCacheKey, type FetchStoreRecord } from './fetch-cache.js';

function record(text: string): FetchStoreRecord {
  return {
    url: 'https://example.com/doc',
    finalUrl: 'https://example.com/doc',
    title: 'Doc',
    text,
    contentType: 'text/html',
    byteSize: text.length,
    truncated: false,
    outline: ['Intro'],
    provider: 'supermarkdown',
  };
}

describe('FetchCache', () => {
  it('normalizes url + provider keys', () => {
    expect(normalizeFetchCacheKey('https://Example.com/doc/#hash', 'supermarkdown')).toBe(
      'supermarkdown:https://example.com/doc',
    );
  });

  it('returns a hit within TTL and misses after expiry', () => {
    let now = 1_000;
    const cache = new FetchCache({ now: () => now });
    cache.set('k', record('hello'));
    expect(cache.get('k', 500)?.text).toBe('hello');
    now = 1_600;
    expect(cache.get('k', 500)).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('evicts older entries when the byte budget is exceeded', () => {
    const cache = new FetchCache({ maxBytes: 400 });
    cache.set('a', record('a'.repeat(80)));
    cache.set('b', record('b'.repeat(80)));
    cache.set('c', record('c'.repeat(300)));
    expect(cache.get('c', 60_000)?.text.startsWith('c')).toBe(true);
    expect(cache.get('a', 60_000)).toBeUndefined();
    expect(cache.size()).toBe(1);
  });
});
