import { describe, expect, it } from 'vitest';
import { alpha, darken, lighten, luminance, mix, parseColor, readableOn, toHex } from './color';

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

describe('alpha', () => {
  it('builds an rgba string from any parseable color', () => {
    expect(alpha('#6e5dff', 0.14)).toBe('rgba(110, 93, 255, 0.14)');
  });

  it('passes unparseable values through untouched', () => {
    expect(alpha('currentColor', 0.5)).toBe('currentColor');
  });
});
