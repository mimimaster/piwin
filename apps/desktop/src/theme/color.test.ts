import { describe, expect, it } from 'vitest';
import {
  alpha,
  contrastRatio,
  darken,
  ensureContrast,
  lighten,
  luminance,
  mix,
  parseColor,
  readableOn,
  toHex,
} from './color';

describe('parseColor', () => {
  it('parses the notations theme manifests actually use', () => {
    expect(parseColor('#08080b')).toEqual({ r: 8, g: 8, b: 11 });
    expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('rgb(20, 18, 30)')).toEqual({ r: 20, g: 18, b: 30 });
    expect(parseColor('rgba(255, 255, 255, 0.055)')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseColor('  #6e5dff  ')).toEqual({ r: 110, g: 93, b: 255 });
  });

  it('returns null rather than black for values it cannot read', () => {
    // Silently degrading to black would turn one bad theme token into an
    // unreadable shell; callers fall back to the input instead.
    expect(parseColor('color-mix(in srgb, red, blue)')).toBeNull();
    expect(parseColor('rebeccapurple')).toBeNull();
    expect(parseColor('')).toBeNull();
  });
});

describe('mix', () => {
  it('interpolates in sRGB', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
  });

  it('returns the first color unchanged when either side is unparseable', () => {
    expect(mix('#123456', 'not-a-color', 0.5)).toBe('#123456');
  });

  it('round-trips through toHex with zero padding', () => {
    expect(toHex({ r: 8, g: 8, b: 11 })).toBe('#08080b');
  });
});

describe('darken and lighten', () => {
  it('move toward black and white', () => {
    expect(darken('#808080', 0.5)).toBe('#404040');
    expect(lighten('#808080', 0.5)).toBe('#c0c0c0');
  });
});

describe('luminance', () => {
  it('anchors at black and white', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('weights green most heavily', () => {
    expect(luminance('#00ff00')).toBeGreaterThan(luminance('#ff0000'));
    expect(luminance('#ff0000')).toBeGreaterThan(luminance('#0000ff'));
  });
});

describe('readableOn', () => {
  it('puts dark text on light fills and light text on dark fills', () => {
    expect(readableOn('#ffffff')).toBe('#141414');
    expect(readableOn('#08080b')).toBe('#ffffff');
  });

  it('keeps white on saturated mid-tone accents', () => {
    // A violet accent sits near the contrast-optimal crossover; white is the
    // readable and conventional choice there.
    expect(readableOn('#6e5dff')).toBe('#ffffff');
    expect(readableOn('#5b4bd6')).toBe('#ffffff');
  });

  it('switches to dark text on bright accents', () => {
    expect(readableOn('#40c0a0')).toBe('#141414');
    expect(readableOn('#f5b544')).toBe('#141414');
  });
});

describe('contrastRatio', () => {
  it('anchors at the WCAG extremes', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 2);
    expect(contrastRatio('#6e5dff', '#6e5dff')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#101014', '#9a9aa8')).toBeCloseTo(contrastRatio('#9a9aa8', '#101014'), 9);
  });
});

describe('ensureContrast', () => {
  it('returns a color that already clears the floor untouched', () => {
    expect(ensureContrast('#ededf2', '#101014', 4.5, '#ffffff')).toBe('#ededf2');
  });

  it('lifts a color that does not, and stops as soon as the floor is met', () => {
    const lifted = ensureContrast('#414150', '#22222b', 3, '#ededf2');
    expect(contrastRatio(lifted, '#22222b')).toBeGreaterThanOrEqual(3);
    // "Least-changed" matters: overshooting collapses the ramp's steps into
    // each other, which is the failure this helper exists to avoid.
    expect(contrastRatio(lifted, '#22222b')).toBeLessThan(3.4);
  });

  it('works in both directions of the ramp', () => {
    const darkened = ensureContrast('#b4b1bc', '#f3f1ed', 3, '#17161b');
    expect(contrastRatio(darkened, '#f3f1ed')).toBeGreaterThanOrEqual(3);
    expect(luminance(darkened)).toBeLessThan(luminance('#b4b1bc'));
  });

  it('falls back to the endpoint when the floor is unreachable', () => {
    // A theme whose text color cannot clear the floor against its own surface
    // has no readable answer; returning the endpoint beats returning the
    // invisible input.
    expect(ensureContrast('#7f7f7f', '#808080', 7, '#818181')).toBe('#818181');
  });
});

describe('alpha', () => {
  it('builds an rgba string from any parseable color', () => {
    expect(alpha('#6e5dff', 0.14)).toBe('rgba(110, 93, 255, 0.14)');
  });

  it('passes unparseable values through untouched', () => {
    expect(alpha('currentColor', 0.5)).toBe('currentColor');
  });
});
