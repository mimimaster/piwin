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

    expect(buildFontStack('Anthropic Sans', DEFAULT_FONT_SANS)).toBe(
      `"Anthropic Sans", ${DEFAULT_FONT_SANS}`,
    );
    expect(buildFontStack('"Anthropic Sans"', DEFAULT_FONT_SANS)).toBe(
      `"Anthropic Sans", ${DEFAULT_FONT_SANS}`,
    );
  });

  it('computes complete font variables with custom preferences', () => {
    const vars = computeFontVariables({
      sansFont: 'Anthropic Sans',
      monoFont: 'Anthropic Mono',
      serifFont: 'Anthropic Serif',
    });

    expect(vars['--font']).toContain('"Anthropic Sans"');
    expect(vars['--font-sans']).toContain('"Anthropic Sans"');
    expect(vars['--sans']).toContain('"Anthropic Sans"');
    expect(vars['--font-mono']).toContain('"Anthropic Mono"');
    expect(vars['--mono']).toContain('"Anthropic Mono"');
    expect(vars['--serif']).toContain('"Anthropic Serif"');
    expect(vars['--font-serif']).toContain('"Anthropic Serif"');
    expect(vars['--mantine-font-family']).toContain('"Anthropic Sans"');
    expect(vars['--mantine-font-family-monospace']).toContain('"Anthropic Mono"');
  });

  it('applies custom fonts to target element and resets cleanly', () => {
    const el = document.createElement('div');
    applyCustomFontsToDocument(
      {
        sansFont: 'Anthropic Sans',
        monoFont: 'Anthropic Mono',
      },
      el,
    );

    expect(el.style.getPropertyValue('--sans')).toContain('"Anthropic Sans"');
    expect(el.style.getPropertyValue('--font-sans')).toContain('"Anthropic Sans"');
    expect(el.style.getPropertyValue('--font-mono')).toContain('"Anthropic Mono"');
    expect(el.style.getPropertyValue('--mantine-font-family')).toContain('"Anthropic Sans"');
    expect(el.style.getPropertyValue('--serif')).toBe(DEFAULT_FONT_SERIF);
    expect(el.style.fontFamily).toContain('"Anthropic Sans"');

    // Resetting clears properties
    applyCustomFontsToDocument(undefined, el);
    expect(el.style.getPropertyValue('--sans')).toBe('');
    expect(el.style.getPropertyValue('--font-sans')).toBe('');
    expect(el.style.getPropertyValue('--mantine-font-family')).toBe('');
    expect(el.style.fontFamily).toBe('');
  });
});
