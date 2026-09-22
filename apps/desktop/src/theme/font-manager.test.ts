// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import {
  applyCustomFontsToDocument,
  buildFontStack,
  computeFontVariables,
  DEFAULT_FONT_SANS,
  DEFAULT_FONT_SERIF,
} from './font-manager.js';

describe('font-manager', () => {
  it('builds font stack correctly with custom font and default fallback', () => {
    expect(buildFontStack(undefined, DEFAULT_FONT_SANS)).toBe(DEFAULT_FONT_SANS);
    expect(buildFontStack('', DEFAULT_FONT_SANS)).toBe(DEFAULT_FONT_SANS);
    expect(buildFontStack('default', DEFAULT_FONT_SANS)).toBe(DEFAULT_FONT_SANS);

    expect(buildFontStack('Sans Variable', DEFAULT_FONT_SANS)).toBe(
      `"Sans Variable", ${DEFAULT_FONT_SANS}`,
    );
    expect(buildFontStack('"Sans Variable"', DEFAULT_FONT_SANS)).toBe(
      `"Sans Variable", ${DEFAULT_FONT_SANS}`,
    );
  });

  it('computes complete font variables with custom preferences', () => {
    const vars = computeFontVariables({
      sansFont: 'Sans Variable',
      monoFont: 'Mono Web',
      serifFont: 'Serif Variable',
    });

    expect(vars['--font']).toContain('"Sans Variable"');
    expect(vars['--font-sans']).toContain('"Sans Variable"');
    expect(vars['--sans']).toContain('"Sans Variable"');
    expect(vars['--font-mono']).toContain('"Mono Web"');
    expect(vars['--mono']).toContain('"Mono Web"');
    expect(vars['--serif']).toContain('"Serif Variable"');
    expect(vars['--font-serif']).toContain('"Serif Variable"');
    expect(vars['--mantine-font-family']).toContain('"Sans Variable"');
    expect(vars['--mantine-font-family-monospace']).toContain('"Mono Web"');
  });

  it('applies custom fonts to target element and resets cleanly', () => {
    const el = document.createElement('div');
    applyCustomFontsToDocument(
      {
        sansFont: 'Sans Variable',
        monoFont: 'Mono Web',
      },
      el,
    );

    expect(el.style.getPropertyValue('--sans')).toContain('"Sans Variable"');
    expect(el.style.getPropertyValue('--font-sans')).toContain('"Sans Variable"');
    expect(el.style.getPropertyValue('--font-mono')).toContain('"Mono Web"');
    expect(el.style.getPropertyValue('--mantine-font-family')).toContain('"Sans Variable"');
    expect(el.style.getPropertyValue('--serif')).toBe(DEFAULT_FONT_SERIF);
    expect(el.style.fontFamily).toContain('"Sans Variable"');

    // Resetting clears properties when no shipped face is registered
    applyCustomFontsToDocument(undefined, el);
    expect(el.style.getPropertyValue('--sans')).toBe('');
    expect(el.style.getPropertyValue('--font-sans')).toBe('');
    expect(el.style.getPropertyValue('--mantine-font-family')).toBe('');
    expect(el.style.fontFamily).toBe('');
  });
});
