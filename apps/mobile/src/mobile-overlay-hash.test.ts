import { describe, expect, it } from 'vitest';
import { readMobileOverlayHash } from './mobile-overlay-hash.js';

describe('readMobileOverlayHash', () => {
  it('maps known hashes and treats the rest as closed', () => {
    expect(readMobileOverlayHash('#settings')).toBe('#settings');
    expect(readMobileOverlayHash('#model')).toBe('#model-picker');
    expect(readMobileOverlayHash('#sidebar')).toBe('#sidebar');
    expect(readMobileOverlayHash('#live')).toBe('#live');
    expect(readMobileOverlayHash('')).toBe('');
    expect(readMobileOverlayHash('#unknown')).toBe('');
  });
});
