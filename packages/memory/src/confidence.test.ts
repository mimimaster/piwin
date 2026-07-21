import { describe, expect, it } from 'vitest';
import { applyConfidencePolicy } from './confidence.js';

describe('applyConfidencePolicy', () => {
  it('downgrades high without quote or review', () => {
    expect(applyConfidencePolicy({ confidence: 'high' })).toBe('medium');
    expect(applyConfidencePolicy({ confidence: 'high', quote: 'ab' })).toBe('medium');
  });

  it('keeps high when quote is long enough', () => {
    expect(applyConfidencePolicy({ confidence: 'high', quote: 'hello' })).toBe('high');
  });

  it('keeps high when reviewed', () => {
    expect(
      applyConfidencePolicy({
        confidence: 'high',
        quote: '',
        reviewedAt: '2026-07-21T00:00:00.000Z',
      }),
    ).toBe('high');
  });

  it('passes through non-high', () => {
    expect(applyConfidencePolicy({ confidence: 'low' })).toBe('low');
    expect(applyConfidencePolicy({ confidence: 'unknown' })).toBe('unknown');
  });
});
