import { describe, expect, it } from 'vitest';
import type { ThemeManifest } from '@piwin/contracts';
import { buildMantineTheme } from './piwin-ui-provider.js';

/**
 * Product dark appearance fixture — mirrors apps/desktop PIWIN_APPEARANCE_DARK
 * tokens so ui-kit tests stay free of a desktop package dependency.
 */
const PIWIN_APPEARANCE_DARK: ThemeManifest = {
  id: 'piwin-dark',
  name: 'Piwin Dark',
  version: '3.0.0',
  description: 'Native graphite dark chrome for piwin shell + artifacts',
  mode: 'dark',
  tokens: {
    bg: '#18181a',
    panel: '#222225',
    panel2: '#2a2a2d',
    border: 'rgba(255, 255, 255, 0.12)',
    text: '#f5f5f7',
    muted: '#a1a1a6',
    accent: '#0a84ff',
    accent2: '#64a7ff',
    danger: '#ff6961',
    ok: '#4cd964',
    radius: '8px',
    font: '"Outfit", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
  },
};

/**
 * Product light appearance fixture — mirrors apps/desktop PIWIN_APPEARANCE_LIGHT
 * tokens for the same reason as the dark fixture above.
 */
const PIWIN_APPEARANCE_LIGHT: ThemeManifest = {
  id: 'piwin-light',
  name: 'Piwin Light',
  version: '3.0.0',
  description: 'Native light chrome for piwin shell + artifacts',
  mode: 'light',
  tokens: {
    bg: '#f5f5f7',
    panel: '#ffffff',
    panel2: '#f7f7f8',
    border: 'rgba(0, 0, 0, 0.12)',
    text: '#1d1d1f',
    muted: '#636366',
    accent: '#007aff',
    accent2: '#0a84ff',
    danger: '#d70015',
    ok: '#248a3d',
    radius: '8px',
    font: '"Outfit", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif',
  },
};

describe('buildMantineTheme', () => {
  it('derives primary accent and font from the theme manifest', () => {
    const mantineTheme = buildMantineTheme(PIWIN_APPEARANCE_DARK);

    expect(mantineTheme.primaryColor).toBe('piwinAccent');
    expect(mantineTheme.fontFamily).toBe(PIWIN_APPEARANCE_DARK.tokens.font);
    expect(mantineTheme.headings?.fontFamily).toBe(PIWIN_APPEARANCE_DARK.tokens.font);

    const accentScale = mantineTheme.colors?.piwinAccent;
    expect(accentScale).toBeDefined();
    if (accentScale === undefined) {
      throw new Error('expected piwinAccent color scale to be defined');
    }

    // Mantine filled components use primary-color index 5.
    expect(accentScale[5]).toBe(PIWIN_APPEARANCE_DARK.tokens.accent);
    expect(accentScale[4]).toBe(PIWIN_APPEARANCE_DARK.tokens.accent2);
  });

  it('anchors graphite scale ends to manifest canvas and panel in dark mode', () => {
    const mantineTheme = buildMantineTheme(PIWIN_APPEARANCE_DARK);
    const graphiteScale = mantineTheme.colors?.piwinGraphite;
    expect(graphiteScale).toBeDefined();
    if (graphiteScale === undefined) {
      throw new Error('expected piwinGraphite color scale to be defined');
    }

    expect(graphiteScale[8]).toBe(PIWIN_APPEARANCE_DARK.tokens.panel);
    expect(graphiteScale[9]).toBe(PIWIN_APPEARANCE_DARK.tokens.bg);
    expect(graphiteScale[4]).toBe(PIWIN_APPEARANCE_DARK.tokens.muted);
  });

  it('derives primary accent and font from the light manifest', () => {
    const mantineTheme = buildMantineTheme(PIWIN_APPEARANCE_LIGHT);

    expect(mantineTheme.primaryColor).toBe('piwinAccent');
    expect(mantineTheme.fontFamily).toBe(PIWIN_APPEARANCE_LIGHT.tokens.font);
    expect(mantineTheme.headings?.fontFamily).toBe(PIWIN_APPEARANCE_LIGHT.tokens.font);

    const accentScale = mantineTheme.colors?.piwinAccent;
    expect(accentScale).toBeDefined();
    if (accentScale === undefined) {
      throw new Error('expected piwinAccent color scale to be defined');
    }

    expect(accentScale[5]).toBe(PIWIN_APPEARANCE_LIGHT.tokens.accent);
    expect(accentScale[4]).toBe(PIWIN_APPEARANCE_LIGHT.tokens.accent2);
  });

  it('anchors graphite scale to manifest canvas and muted in light mode', () => {
    const mantineTheme = buildMantineTheme(PIWIN_APPEARANCE_LIGHT);
    const graphiteScale = mantineTheme.colors?.piwinGraphite;
    expect(graphiteScale).toBeDefined();
    if (graphiteScale === undefined) {
      throw new Error('expected piwinGraphite color scale to be defined');
    }

    // Light mode reads forward: index 0 is the lightest base canvas.
    expect(graphiteScale[0]).toBe(PIWIN_APPEARANCE_LIGHT.tokens.bg);
    expect(graphiteScale[5]).toBe(PIWIN_APPEARANCE_LIGHT.tokens.muted);
  });

  it('emits the same scale structure for both manifests — only values differ', () => {
    const darkTheme = buildMantineTheme(PIWIN_APPEARANCE_DARK);
    const lightTheme = buildMantineTheme(PIWIN_APPEARANCE_LIGHT);

    expect(Object.keys(darkTheme.colors ?? {})).toEqual(Object.keys(lightTheme.colors ?? {}));
    expect(darkTheme.colors?.piwinGraphite).toHaveLength(10);
    expect(lightTheme.colors?.piwinGraphite).toHaveLength(10);
    expect(darkTheme.colors?.piwinAccent?.[5]).not.toBe(lightTheme.colors?.piwinAccent?.[5]);
  });
});
