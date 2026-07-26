// @vitest-environment happy-dom
// R1 exit criterion: appearance-tokens.ts is the single runtime authority for
// color/typography variables, and themes are value swaps only (identical
// variable-name set, different values).

import { describe, expect, it, beforeEach } from 'vitest';
import {
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_LIGHT,
  applyAppearanceToDocument,
} from './appearance-tokens';

/**
 * The complete documented variable set emitted by applyAppearanceToDocument.
 * Kept inline and sorted on purpose: any addition or removal in
 * appearance-tokens.ts must be mirrored here, so token surface changes are
 * always a deliberate, reviewed edit.
 */
const DOCUMENTED_APPEARANCE_VARIABLES = [
  '--accent',
  '--accent-2',
  '--accent-soft',
  '--bg',
  '--border',
  '--border-default',
  '--border-emphasis',
  '--border-interactive',
  '--border-subtle',
  '--canvas',
  '--content-disabled',
  '--content-muted',
  '--content-on-accent',
  '--content-primary',
  '--content-secondary',
  '--control-height-compact',
  '--control-height-default',
  '--control-height-large',
  '--danger',
  '--duration-fast',
  '--duration-standard',
  '--easing-standard',
  '--faint',
  '--focus-ring',
  '--font',
  '--line',
  '--line-soft',
  '--line-strong',
  '--mono',
  '--motion-fast',
  '--motion-standard',
  '--muted',
  '--ok',
  '--overlay-backdrop',
  '--panel',
  '--radius',
  '--radius-control',
  '--radius-overlay',
  '--radius-sm',
  '--radius-surface',
  '--rail',
  '--sage',
  '--shadow',
  '--shadow-overlay',
  '--sidebar',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--space-5',
  '--space-6',
  '--space-7',
  '--space-8',
  '--state-danger',
  '--state-running',
  '--state-success',
  '--state-waiting',
  '--state-warning',
  '--surface',
  '--surface-canvas',
  '--surface-control',
  '--surface-control-hover',
  '--surface-hover',
  '--surface-inset',
  '--surface-overlay',
  '--surface-rail',
  '--surface-raised',
  '--surface-selected',
  '--surface-sidebar',
  '--text',
  '--violet',
  '--wb-accent-soft',
  '--wb-dim',
  '--wb-hover',
  '--wb-line',
  '--wb-send-fg',
  '--wb-term-bg',
] as const;

/**
 * Aliases deleted in R1; re-introducing them must fail the suite.
 * Names are stored without the `--` prefix so the repo-wide grep gate for the
 * removed aliases keeps returning zero hits, including in this file.
 */
const REMOVED_LEGACY_ALIASES = ['blue', 'panel-2'].map((name) => `--${name}`);

/** Geometry lives in styles/tokens.css; the runtime must not write it inline. */
const GEOMETRY_VARIABLES = [
  '--topbar-height',
  '--titleband-height',
  '--rail-width',
  '--signal-rail-width',
  '--sidebar-width',
  '--right-panel-width',
  '--chat-max',
] as const;

function emittedVariableNames(style: CSSStyleDeclaration): string[] {
  const names: string[] = [];
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index);
    if (name.startsWith('--')) {
      names.push(name);
    }
  }
  return names.sort();
}

describe('applyAppearanceToDocument', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    delete document.documentElement.dataset.themeMode;
    delete document.documentElement.dataset.themeId;
  });

  it('emits the full documented variable set for the dark manifest', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);

    const style = document.documentElement.style;
    expect(emittedVariableNames(style)).toEqual([...DOCUMENTED_APPEARANCE_VARIABLES]);
    for (const name of DOCUMENTED_APPEARANCE_VARIABLES) {
      expect(style.getPropertyValue(name), `dark ${name}`).not.toBe('');
    }
  });

  it('emits the full documented variable set for the light manifest', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_LIGHT);

    const style = document.documentElement.style;
    expect(emittedVariableNames(style)).toEqual([...DOCUMENTED_APPEARANCE_VARIABLES]);
    for (const name of DOCUMENTED_APPEARANCE_VARIABLES) {
      expect(style.getPropertyValue(name), `light ${name}`).not.toBe('');
    }
  });

  it('makes theme switching a value swap only — identical variable-name sets', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);
    const darkNames = emittedVariableNames(document.documentElement.style);
    const darkCanvas = document.documentElement.style.getPropertyValue('--canvas');

    applyAppearanceToDocument(PIWIN_APPEARANCE_LIGHT);
    const lightNames = emittedVariableNames(document.documentElement.style);
    const lightCanvas = document.documentElement.style.getPropertyValue('--canvas');

    expect(lightNames).toEqual(darkNames);
    expect(lightCanvas).not.toBe(darkCanvas);
  });

  it('does not emit removed legacy aliases', () => {
    for (const manifest of [PIWIN_APPEARANCE_DARK, PIWIN_APPEARANCE_LIGHT]) {
      applyAppearanceToDocument(manifest);
      for (const alias of REMOVED_LEGACY_ALIASES) {
        expect(
          document.documentElement.style.getPropertyValue(alias),
          `${manifest.id} ${alias}`,
        ).toBe('');
      }
    }
  });

  it('strips inline geometry variables written by older builds', () => {
    for (const name of GEOMETRY_VARIABLES) {
      document.documentElement.style.setProperty(name, '999px');
    }

    applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);

    for (const name of GEOMETRY_VARIABLES) {
      expect(document.documentElement.style.getPropertyValue(name), name).toBe('');
    }
  });

  it('sets theme identity attributes for both manifests', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.themeId).toBe('piwin-dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    applyAppearanceToDocument(PIWIN_APPEARANCE_LIGHT);
    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(document.documentElement.dataset.themeId).toBe('piwin-light');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});
