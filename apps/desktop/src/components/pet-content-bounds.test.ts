import { describe, expect, it } from 'vitest';
import { defaultPetContentBounds, detectPetContentBounds } from './pet-content-bounds.js';

describe('defaultPetContentBounds', () => {
  it('returns cellWidth x cellHeight bounds starting at (0, 0)', () => {
    expect(defaultPetContentBounds(48, 52)).toEqual({
      x: 0,
      y: 0,
      width: 48,
      height: 52,
    });
  });

  it('provides safe fallbacks for zero or negative values', () => {
    expect(defaultPetContentBounds(0, 0)).toEqual({
      x: 0,
      y: 0,
      width: 48,
      height: 52,
    });
  });
});

describe('detectPetContentBounds', () => {
  it('returns fallback bounds when image is null', () => {
    expect(detectPetContentBounds(null, 48, 52)).toEqual({
      x: 0,
      y: 0,
      width: 48,
      height: 52,
    });
  });

  it('returns fallback bounds when image dimensions are 0', () => {
    const dummy = { naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement;
    expect(detectPetContentBounds(dummy, 48, 52)).toEqual({
      x: 0,
      y: 0,
      width: 48,
      height: 52,
    });
  });
});
