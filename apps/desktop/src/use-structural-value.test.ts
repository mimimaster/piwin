import { describe, expect, it } from 'vitest';
import { isStructurallyEqual } from './use-structural-value.js';

describe('isStructurallyEqual', () => {
  it('compares plain data by content', () => {
    expect(isStructurallyEqual([{ id: 'a', n: 1 }], [{ id: 'a', n: 1 }])).toBe(true);
    expect(isStructurallyEqual([{ id: 'a', n: 1 }], [{ id: 'a', n: 2 }])).toBe(false);
    expect(isStructurallyEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(isStructurallyEqual([], {})).toBe(false);
    expect(isStructurallyEqual(null, {})).toBe(false);
    expect(isStructurallyEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it('compares functions by identity', () => {
    const handler = (): void => {};
    expect(isStructurallyEqual({ onOpen: handler }, { onOpen: handler })).toBe(true);
    expect(isStructurallyEqual({ onOpen: handler }, { onOpen: () => {} })).toBe(false);
  });
});
