// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_INK_WASH,
  PIWIN_APPEARANCE_LIGHT,
  applyAppearanceToDocument,
} from './appearance-tokens';
import {
  isDocumentThemeId,
  isStartupBuiltinThemeId,
  rememberAppliedTheme,
  resolveStartupAppearance,
} from './theme-startup';

describe('resolveStartupAppearance', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme-id');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('rebuilds from Appearance prefs when no last theme is stored', () => {
    localStorage.setItem('piwin.desktop.appearanceMode', 'dark');
    const theme = resolveStartupAppearance();
    expect(theme.id).toBe('piwin-inkstone-ink');
    expect(theme.mode).toBe('dark');
  });

  it('pre-paints ink-wash from the last applied library theme id', () => {
    localStorage.setItem('piwin.desktop.lastThemeId', 'piwin-ink-wash');
    const theme = resolveStartupAppearance();
    expect(theme).toBe(PIWIN_APPEARANCE_INK_WASH);
  });

  it('migrates a retired default face into Inkstone', () => {
    localStorage.setItem('piwin.desktop.lastThemeId', 'piwin-light');
    const theme = resolveStartupAppearance();
    expect(theme).toBe(PIWIN_APPEARANCE_LIGHT);
  });

  it('lets the selected system mode choose Inkstone paper or ink on cold start', () => {
    localStorage.setItem('piwin.desktop.lastThemeId', 'piwin-inkstone-ink');
    localStorage.setItem('piwin.desktop.appearanceMode', 'light');
    expect(resolveStartupAppearance()).toBe(PIWIN_APPEARANCE_LIGHT);
  });

  it('falls back to Appearance prefs for unknown / custom theme ids', () => {
    localStorage.setItem('piwin.desktop.lastThemeId', 'community-nord');
    localStorage.setItem('piwin.desktop.appearanceMode', 'light');
    const theme = resolveStartupAppearance();
    expect(theme.id).toBe('piwin-inkstone-paper');
  });

  it('falls back to Appearance prefs for appearance-derived theme ids', () => {
    localStorage.setItem('piwin.desktop.lastThemeId', 'piwin-dark-appearance');
    localStorage.setItem('piwin.desktop.appearanceMode', 'dark');
    const theme = resolveStartupAppearance();
    expect(theme.id).toBe('piwin-inkstone-ink');
  });
});

describe('rememberAppliedTheme / isDocumentThemeId', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme-id');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('persists the applied theme id for the next cold start', () => {
    rememberAppliedTheme(PIWIN_APPEARANCE_INK_WASH);
    expect(localStorage.getItem('piwin.desktop.lastThemeId')).toBe('piwin-ink-wash');
  });

  it('detects when document already matches the resolved id', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);
    expect(isDocumentThemeId('piwin-dark')).toBe(true);
    expect(isDocumentThemeId('piwin-ink-wash')).toBe(false);
  });

  it('treats Appearance overlay ids as the Inkstone face already on the document', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_LIGHT);
    expect(isDocumentThemeId('piwin-light-appearance')).toBe(true);
    expect(isDocumentThemeId('piwin-inkstone-paper')).toBe(true);
  });

  it('classifies product library themes as startup-safe builtins', () => {
    expect(isStartupBuiltinThemeId('piwin-ink-wash')).toBe(true);
    expect(isStartupBuiltinThemeId('piwin-dark-appearance')).toBe(false);
    expect(isStartupBuiltinThemeId('community-nord')).toBe(false);
  });
});
