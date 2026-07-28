import { describe, expect, it } from 'vitest';
import { buildMantineTheme } from './piwin-ui-provider.js';
import { TEST_THEME_DARK, TEST_THEME_LIGHT } from './test-theme-fixtures.js';

describe('buildMantineTheme', () => {
  it('derives primary accent and font from the theme manifest', () => {
    const mantineTheme = buildMantineTheme(TEST_THEME_DARK);

    expect(mantineTheme.primaryColor).toBe('piwinAccent');
    expect(mantineTheme.fontFamily).toBe(TEST_THEME_DARK.tokens.font);
    expect(mantineTheme.headings?.fontFamily).toBe(TEST_THEME_DARK.tokens.font);

    const accentScale = mantineTheme.colors?.piwinAccent;
    expect(accentScale).toBeDefined();
    if (accentScale === undefined) {
      throw new Error('expected piwinAccent color scale to be defined');
    }

    // Mantine filled components use primary-color index 5.
    expect(accentScale[5]).toBe(TEST_THEME_DARK.tokens.accent);
    expect(accentScale[4]).toBe(TEST_THEME_DARK.tokens.accent2);
  });

  it('anchors graphite scale ends to manifest canvas and panel in dark mode', () => {
    const mantineTheme = buildMantineTheme(TEST_THEME_DARK);
    const graphiteScale = mantineTheme.colors?.piwinGraphite;
    expect(graphiteScale).toBeDefined();
    if (graphiteScale === undefined) {
      throw new Error('expected piwinGraphite color scale to be defined');
    }

    expect(graphiteScale[8]).toBe(TEST_THEME_DARK.tokens.panel);
    expect(graphiteScale[9]).toBe(TEST_THEME_DARK.tokens.bg);
    expect(graphiteScale[4]).toBe(TEST_THEME_DARK.tokens.muted);
  });

  it('derives primary accent and font from the light manifest', () => {
    const mantineTheme = buildMantineTheme(TEST_THEME_LIGHT);

    expect(mantineTheme.primaryColor).toBe('piwinAccent');
    expect(mantineTheme.fontFamily).toBe(TEST_THEME_LIGHT.tokens.font);
    expect(mantineTheme.headings?.fontFamily).toBe(TEST_THEME_LIGHT.tokens.font);

    const accentScale = mantineTheme.colors?.piwinAccent;
    expect(accentScale).toBeDefined();
    if (accentScale === undefined) {
      throw new Error('expected piwinAccent color scale to be defined');
    }

    expect(accentScale[5]).toBe(TEST_THEME_LIGHT.tokens.accent);
    expect(accentScale[4]).toBe(TEST_THEME_LIGHT.tokens.accent2);
  });

  it('anchors graphite scale to manifest canvas and muted in light mode', () => {
    const mantineTheme = buildMantineTheme(TEST_THEME_LIGHT);
    const graphiteScale = mantineTheme.colors?.piwinGraphite;
    expect(graphiteScale).toBeDefined();
    if (graphiteScale === undefined) {
      throw new Error('expected piwinGraphite color scale to be defined');
    }

    // Light mode reads forward: index 0 is the lightest base canvas.
    expect(graphiteScale[0]).toBe(TEST_THEME_LIGHT.tokens.bg);
    expect(graphiteScale[5]).toBe(TEST_THEME_LIGHT.tokens.muted);
  });

  it('emits the same scale structure for both manifests — only values differ', () => {
    const darkTheme = buildMantineTheme(TEST_THEME_DARK);
    const lightTheme = buildMantineTheme(TEST_THEME_LIGHT);

    expect(Object.keys(darkTheme.colors ?? {})).toEqual(Object.keys(lightTheme.colors ?? {}));
    expect(darkTheme.colors?.piwinGraphite).toHaveLength(10);
    expect(lightTheme.colors?.piwinGraphite).toHaveLength(10);
    expect(darkTheme.colors?.piwinAccent?.[5]).not.toBe(lightTheme.colors?.piwinAccent?.[5]);
  });
});
