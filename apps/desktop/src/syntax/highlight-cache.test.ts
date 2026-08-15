import { describe, expect, it } from 'vitest';
import { HighlightLruCache } from './highlight-cache';
import type { TokenLine } from './highlight-protocol';

describe('HighlightLruCache', () => {
  it('stores and retrieves cache entries', () => {
    const cache = new HighlightLruCache(10, 1024 * 1024);
    const tokens: TokenLine[] = [[{ content: 'const a = 1;', offset: 0 }]];

    cache.set('key1', tokens, 50);
    expect(cache.get('key1')).toEqual(tokens);
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('evicts oldest entries when maxEntries is exceeded', () => {
    const cache = new HighlightLruCache(2, 1024 * 1024);
    const tokens1: TokenLine[] = [[{ content: '1', offset: 0 }]];
    const tokens2: TokenLine[] = [[{ content: '2', offset: 0 }]];
    const tokens3: TokenLine[] = [[{ content: '3', offset: 0 }]];

    cache.set('k1', tokens1, 10);
    cache.set('k2', tokens2, 10);
    expect(cache.getEntryCount()).toBe(2);

    // Adding 3rd key should evict k1
    cache.set('k3', tokens3, 10);
    expect(cache.getEntryCount()).toBe(2);
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k2')).not.toBeNull();
    expect(cache.get('k3')).not.toBeNull();
  });

  it('evicts oldest entries when maxBytes is exceeded', () => {
    // 200 bytes max
    const cache = new HighlightLruCache(100, 200);
    const tokens1: TokenLine[] = [[{ content: 'a'.repeat(50), offset: 0 }]];
    const tokens2: TokenLine[] = [[{ content: 'b'.repeat(50), offset: 0 }]];

    cache.set('k1', tokens1, 80);
    cache.set('k2', tokens2, 80);

    const tokens3: TokenLine[] = [[{ content: 'c'.repeat(50), offset: 0 }]];
    cache.set('k3', tokens3, 80);

    expect(cache.getTotalBytes()).toBeLessThanOrEqual(200);
  });

  it('rejects oversized entries exceeding maxSourceBytesPerEntry', () => {
    const cache = new HighlightLruCache(100, 10 * 1024 * 1024, 1000);
    const tokens: TokenLine[] = [[{ content: 'huge', offset: 0 }]];

    // 2000 bytes > 1000 limit
    cache.set('hugeKey', tokens, 2000);
    expect(cache.get('hugeKey')).toBeNull();
    expect(cache.getEntryCount()).toBe(0);
  });
});
