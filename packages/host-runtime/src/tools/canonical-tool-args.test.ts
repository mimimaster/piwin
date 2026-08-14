import { describe, expect, it } from 'vitest';
import { validateCanonicalArguments } from './canonical-tool-args.js';

describe('validateCanonicalArguments', () => {
  it('accepts JSON-compatible trees and skips undefined object fields', () => {
    expect(
      validateCanonicalArguments({
        path: '/tmp/a.ts',
        flag: true,
        count: 1,
        nested: { keep: 'x', drop: undefined },
        items: ['a', null],
      }).ok,
    ).toBe(true);
  });

  it('rejects dates, non-finite numbers, sparse arrays, and symbol keys', () => {
    expect(validateCanonicalArguments(new Date()).ok).toBe(false);
    expect(validateCanonicalArguments({ n: Number.NaN }).ok).toBe(false);
    const sparse: unknown[] = [];
    sparse[1] = 'b';
    expect(validateCanonicalArguments(sparse).ok).toBe(false);
    expect(validateCanonicalArguments({ [Symbol('k')]: 1 }).ok).toBe(false);
  });
});
