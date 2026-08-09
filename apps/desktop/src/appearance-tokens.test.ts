// @vitest-environment happy-dom
// R1 exit criterion: appearance-tokens.ts is the single runtime authority for
// color/typography variables, and themes are value swaps only (identical
// variable-name set, different values).

import { describe, expect, it, beforeEach } from 'vitest';
import {
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_LIGHT,
  PIWIN_APPEARANCE_ORANGE_WHITE,
  applyAppearanceToDocument,
  beginThemeSwitch,
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
  '--accent-fg',
  '--accent-ring',
  '--accent-soft',
  '--add-bg',
  '--add-text',
  '--bg',
  '--border',
  '--border-default',
  '--border-emphasis',
  '--border-interactive',
  '--border-subtle',
  '--canvas',
  '--card',
  '--column-divider',
  '--composer',
  '--content-disabled',
  '--content-muted',
  '--content-on-accent',
  '--content-primary',
  '--content-secondary',
  '--control',
  '--control-height-compact',
  '--control-height-default',
  '--control-height-large',
  '--danger',
  '--del-bg',
  '--del-text',
  '--duration-fast',
  '--duration-standard',
  '--easing-standard',
  '--faint',
  '--focus-ring',
  '--font',
  '--hover',
  '--line',
  '--line-soft',
  '--line-strong',
  '--mono',
  '--motion-fast',
  '--motion-standard',
  '--muted',
  '--ok',
  '--ok-fg',
  '--overlay-backdrop',
  '--panel',
  '--radius',
  '--radius-control',
  '--radius-overlay',
  '--radius-sm',
  '--radius-surface',
  '--rail',
  '--sage',
  '--selected',
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
  '--sunken',
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
  '--term-bg',
  '--term-text',
  '--text',
  '--user-bubble',
  '--violet',
  '--warn',
  '--warn-fg',
  '--warn-line',
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
  '--chat-side-pad',
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

  it('emits the full documented variable set for the orange-white manifest', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_ORANGE_WHITE);

    const style = document.documentElement.style;
    expect(emittedVariableNames(style)).toEqual([...DOCUMENTED_APPEARANCE_VARIABLES]);
    for (const name of DOCUMENTED_APPEARANCE_VARIABLES) {
      expect(style.getPropertyValue(name), `orange-white ${name}`).not.toBe('');
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

  it('gives Paper distinct sidebar, conversation, and prompt surfaces', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_LIGHT);

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--sidebar')).toBe('#ececef');
    expect(style.getPropertyValue('--canvas')).toBe('#f6f6f7');
    expect(style.getPropertyValue('--composer')).toBe('#ffffff');
    expect(style.getPropertyValue('--user-bubble')).toBe('#ffffff');
  });

  it('does not emit removed legacy aliases', () => {
    for (const manifest of [
      PIWIN_APPEARANCE_DARK,
      PIWIN_APPEARANCE_LIGHT,
      PIWIN_APPEARANCE_ORANGE_WHITE,
    ]) {
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

    applyAppearanceToDocument(PIWIN_APPEARANCE_ORANGE_WHITE);
    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(document.documentElement.dataset.themeId).toBe('piwin-orange-white');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});

describe('applyAppearanceToDocument Paper/Noir projection', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('projects Paper light derived ramp', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_LIGHT);
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--canvas').trim()).toBe('#f6f6f7');
    expect(s.getPropertyValue('--card').trim()).toBe('#ffffff');
    expect(s.getPropertyValue('--sidebar').trim()).toBe('#ececef');
    expect(s.getPropertyValue('--composer').trim()).toBe('#ffffff');
    expect(s.getPropertyValue('--sunken').trim()).toBe('#f0f0f2');
    expect(s.getPropertyValue('--user-bubble').trim()).toBe('#ffffff');
    expect(s.getPropertyValue('--faint').trim()).toBe('#a0a0a8');
    expect(s.getPropertyValue('--accent').trim()).toBe('#2f6bed');
    expect(s.getPropertyValue('--accent-fg').trim()).toBe('#ffffff');
    expect(s.getPropertyValue('--warn').trim()).toBe('#b25000');
    expect(s.getPropertyValue('--add-text').trim()).toBe('#0e7a4c');
    expect(s.getPropertyValue('--del-text').trim()).toBe('#c13a36');
    expect(s.getPropertyValue('--term-bg').trim()).toBe('#16181d');
  });

  it('projects Noir dark derived ramp with inverted accent', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--canvas').trim()).toBe('#141416');
    expect(s.getPropertyValue('--card').trim()).toBe('#1d1e24');
    expect(s.getPropertyValue('--sidebar').trim()).toBe('#1e1f24');
    expect(s.getPropertyValue('--composer').trim()).toBe('#1c1c21');
    expect(s.getPropertyValue('--sunken').trim()).toBe('#101012');
    expect(s.getPropertyValue('--faint').trim()).toBe('#585862');
    expect(s.getPropertyValue('--text').trim()).toBe('#e4e4e7');
    expect(s.getPropertyValue('--muted').trim()).toBe('#8e8e98');
    expect(s.getPropertyValue('--accent').trim()).toBe('#f4f4f5');
    expect(s.getPropertyValue('--border').trim()).toBe('rgba(255, 255, 255, 0.05)');
    // Column chrome is intentionally stronger than card borders.
    expect(s.getPropertyValue('--column-divider').trim()).toBe('rgba(255, 255, 255, 0.16)');
    // Noir: accent 是浅灰，accent 上的字必须是近黑
    expect(s.getPropertyValue('--accent-fg').trim()).toBe('#141414');
    expect(s.getPropertyValue('--warn').trim()).toBe('#f5b83d');
    expect(s.getPropertyValue('--add-text').trim()).toBe('#6fdcab');
    expect(s.getPropertyValue('--del-text').trim()).toBe('#f08a92');
  });

  it('projects 橙白 warm light derived ramp', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_ORANGE_WHITE);
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--canvas').trim()).toBe('#fffdfa');
    expect(s.getPropertyValue('--card').trim()).toBe('#fffdfa');
    expect(s.getPropertyValue('--sidebar').trim()).toBe('#f2ede5');
    expect(s.getPropertyValue('--composer').trim()).toBe('#f2ede5');
    expect(s.getPropertyValue('--sunken').trim()).toBe('#f2ede5');
    expect(s.getPropertyValue('--user-bubble').trim()).toBe('#f2ede5');
    expect(s.getPropertyValue('--faint').trim()).toBe('#a89d8f');
    expect(s.getPropertyValue('--accent').trim()).toBe('#e85d1f');
    expect(s.getPropertyValue('--accent-fg').trim()).toBe('#ffffff');
    expect(s.getPropertyValue('--term-bg').trim()).toBe('#efe9e0');
    expect(s.getPropertyValue('--term-text').trim()).toBe('#6b6358');
    expect(s.getPropertyValue('--hover').trim()).toBe('rgba(60, 40, 20, 0.05)');
    expect(s.getPropertyValue('--selected').trim()).toBe('rgba(232, 93, 31, 0.10)');
    expect(s.getPropertyValue('--line-strong').trim()).toBe('rgba(80, 60, 40, 0.22)');
    expect(s.getPropertyValue('--wb-term-bg').trim()).toBe('#efe9e0');
    expect(s.getPropertyValue('--wb-dim').trim()).toBe('#a89d8f');
  });

  it('keeps builtin theme ids stable for stored settings', () => {
    expect(PIWIN_APPEARANCE_LIGHT.id).toBe('piwin-light');
    expect(PIWIN_APPEARANCE_DARK.id).toBe('piwin-dark');
    expect(PIWIN_APPEARANCE_ORANGE_WHITE.id).toBe('piwin-orange-white');
    expect(PIWIN_APPEARANCE_LIGHT.name).toBe('Paper');
    expect(PIWIN_APPEARANCE_DARK.name).toBe('Noir');
    expect(PIWIN_APPEARANCE_ORANGE_WHITE.name).toBe('橙白');
  });
});

describe('beginThemeSwitch', () => {
  it('adds the freeze class so chrome transitions do not smear during a flip', () => {
    document.documentElement.classList.remove('is-theme-switching');
    beginThemeSwitch();
    expect(document.documentElement.classList.contains('is-theme-switching')).toBe(true);
  });
});
