import { describe, expect, it } from 'vitest';
import { quotaBarFillPercent } from './subscription-quota-drawer.js';

describe('quotaBarFillPercent', () => {
  it('fills remaining 100% as a full colored bar', () => {
    expect(quotaBarFillPercent({ type: 'remaining', percentage: 100 })).toBe(100);
  });

  it('fills used 0% as a full remaining bar', () => {
    expect(quotaBarFillPercent({ type: 'used', percentage: 0 })).toBe(100);
  });

  it('shrinks as remaining drops', () => {
    expect(quotaBarFillPercent({ type: 'remaining', percentage: 63 })).toBe(63);
    expect(quotaBarFillPercent({ type: 'used', percentage: 37 })).toBe(63);
  });

  it('is empty when quota is exhausted', () => {
    expect(quotaBarFillPercent({ type: 'remaining', percentage: 0 })).toBe(0);
    expect(quotaBarFillPercent({ type: 'used', percentage: 100 })).toBe(0);
  });
});
