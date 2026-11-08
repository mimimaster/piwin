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

  it('rejects a single oversized entry without evicting everything first', () => {
    // maxBytes = 200; each entry estimates max(source*2, tokens*64) = 160.
    const cache = new HighlightLruCache(100, 200);
    const tokens: TokenLine[] = [[{ content: 'a'.repeat(50), offset: 0 }]];
    cache.set('k1', tokens, 80);
    expect(cache.getEntryCount()).toBe(1);

    // Estimated 800 bytes > 200 maxBytes: rejected outright, k1 untouched.
    cache.set('huge', [[{ content: 'b'.repeat(400), offset: 0 }]], 400);
    expect(cache.get('huge')).toBeNull();
    expect(cache.get('k1')).not.toBeNull();
    expect(cache.getTotalBytes()).toBeLessThanOrEqual(200);
  });

  it('rejects every admission while maxEntries is zero', () => {
    const cache = new HighlightLruCache(100, 10 * 1024 * 1024);
    cache.applyBudget({ evictAll: true, maxEntries: 0, maxBytes: 0 });
    cache.set('k1', [[{ content: 'x', offset: 0 }]], 10);
    expect(cache.getEntryCount()).toBe(0);

    // Budget restored → entries admitted again.
    cache.restoreDefaultBudget();
    cache.set('k2', [[{ content: 'y', offset: 0 }]], 10);
    expect(cache.get('k2')).not.toBeNull();
  });

  it('applyBudget trims LRU-first to the byte cap while evictAll clears', () => {
    const cache = new HighlightLruCache(100, 10 * 1024 * 1024);
    const tokens: TokenLine[] = [[{ content: 'a'.repeat(50), offset: 0 }]];
    cache.set('k1', tokens, 80); // ~160 bytes estimate
    cache.set('k2', tokens, 80);
    cache.set('k3', tokens, 80);
    cache.get('k1'); // touch: k1 is now newest

    cache.applyBudget({ evictAll: true, maxBytes: 200 });
    // evictAll cleared contents; refill budget is 200 bytes → one entry fits.
    expect(cache.getEntryCount()).toBe(0);
    cache.set('k4', tokens, 80);
    cache.set('k5', tokens, 80);
    expect(cache.getTotalBytes()).toBeLessThanOrEqual(200);
    expect(cache.get('k5')).not.toBeNull();
    expect(cache.get('k4')).toBeNull();
  });

  it('trimToBudget without evictAll keeps newest entries under the cap', () => {
    const cache = new HighlightLruCache(100, 10 * 1024 * 1024);
    const tokens: TokenLine[] = [[{ content: 'a'.repeat(50), offset: 0 }]];
    cache.set('k1', tokens, 80);
    cache.set('k2', tokens, 80);
    cache.applyBudget({ maxBytes: 200 });
    expect(cache.get('k1')).toBeNull();
    expect(cache.get('k2')).not.toBeNull();
    expect(cache.getTotalBytes()).toBeLessThanOrEqual(200);
  });
});
