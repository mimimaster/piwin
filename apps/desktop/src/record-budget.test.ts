import { describe, expect, it } from 'vitest';
import {
  appendBoundedPtyOutput,
  capSeenKeys,
  evictCompletedFirst,
  putRecordLru,
  retainRecordKeys,
} from './record-budget';

describe('putRecordLru', () => {
  it('evicts the oldest key and refreshes a touched key', () => {
    let cache = putRecordLru({}, 'a', 1, 2);
    cache = putRecordLru(cache, 'b', 2, 2);
    cache = putRecordLru(cache, 'c', 3, 2);
    expect(cache).toEqual({ b: 2, c: 3 });

    cache = putRecordLru(cache, 'b', 20, 2);
    cache = putRecordLru(cache, 'd', 4, 2);
    expect(cache).toEqual({ b: 20, d: 4 });
  });

  it('does not evict a protected key', () => {
    let cache = putRecordLru({}, 'keep', 1, 2);
    cache = putRecordLru(cache, 'old', 2, 2);
    cache = putRecordLru(cache, 'new', 3, 2, ['keep']);
    expect(cache).toEqual({ keep: 1, new: 3 });
  });
});

describe('retainRecordKeys', () => {
  it('keeps only the listed keys', () => {
    expect(retainRecordKeys({ a: 1, b: 2, c: 3 }, ['b', 'missing'])).toEqual({ b: 2 });
  });
});

describe('evictCompletedFirst', () => {
  it('drops completed entries before live ones', () => {
    const next = evictCompletedFirst(
      {
        done1: { live: false },
        live: { live: true },
        done2: { live: false },
        extra: { live: false },
      },
      2,
      (value) => !value.live,
    );
    expect(next).toEqual({ live: { live: true }, extra: { live: false } });
  });
});

describe('capSeenKeys', () => {
  it('drops the oldest keys in insertion order', () => {
    const seen = new Set(['a', 'b', 'c']);
    capSeenKeys(seen, 2);
    expect([...seen]).toEqual(['b', 'c']);
  });
});

describe('appendBoundedPtyOutput', () => {
  it('caps line count and total bytes while keeping the newest line', () => {
    const byCount = appendBoundedPtyOutput(
      [
        { data: 'one' },
        { data: 'two' },
        { data: 'three' },
      ],
      { data: 'four' },
      3,
      10_000,
    );
    expect(byCount.map((line) => line.data)).toEqual(['two', 'three', 'four']);

    const byBytes = appendBoundedPtyOutput(
      [{ data: 'aaaa' }, { data: 'bbbb' }],
      { data: 'cccc' },
      99,
      8,
    );
    expect(byBytes.map((line) => line.data)).toEqual(['bbbb', 'cccc']);
  });
});
