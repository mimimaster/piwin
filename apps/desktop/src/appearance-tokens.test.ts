// @vitest-environment happy-dom
// appearance-tokens is the single runtime authority for color/elevation/
// typography variables, and switching themes is a value swap only: every
// manifest emits the identical variable-name set.

import { describe, expect, it, beforeEach } from 'vitest';
import type { ThemeManifest } from '@piwin/contracts';
import {
  BUILTIN_APPEARANCES,
  PIWIN_APPEARANCE_BONE,
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_INK_WASH,
  PIWIN_APPEARANCE_INKSTONE_INK,
  PIWIN_APPEARANCE_INKSTONE_PAPER,
  PIWIN_INKSTONE_THEME_ID,
  PIWIN_APPEARANCE_LIGHT,
  PIWIN_APPEARANCE_OBSIDIAN,
  applyAppearanceToDocument,
  beginThemeSwitch,
  buildAppearanceTheme,
  deriveDeckTokens,
  isAppearanceFaceId,
  isBuiltinAppearanceId,
  isInkstoneThemeId,
  migrateThemeId,
  resolveBuiltinAppearance,
  toHostCatalogThemeId,
  resolveDesktopAppearance,
} from './appearance-tokens';
import type { AppearanceThemeSettings } from './ui-preferences';

/**
 * The complete documented variable set emitted by applyAppearanceToDocument.
 * Kept inline and sorted on purpose: any addition or removal in the theme
 * layer must be mirrored here, so token surface changes are always a
 * deliberate, reviewed edit.
 *
 * Three families:
 *   Deck     --void / --surface-N / --text-N / --line-N / --iris* / signals
 *   Depth    --elev-1..4
 *   Slab     --slab* — composer-scoped roles, ambient-valued by default;
 *            Inkstone strips the inline set so tokens.css owns proto hex
 *   Legacy   pre-Deck names mapped onto Deck roles (retire with their region)
 */
const DOCUMENTED_APPEARANCE_VARIABLES = [
  '--accent',
  '--accent-2',
  '--accent-fg',
  '--accent-ring',
  '--accent-soft',
  '--active',
  '--add-bg',
  '--add-text',
  '--amber',
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
  '--coral',
  '--danger',
  '--del-bg',
  '--del-text',
  '--duration-fast',
  '--duration-standard',
  '--easing-standard',
  '--elev-1',
  '--elev-2',
  '--elev-3',
  '--elev-4',
  '--ember',
  '--ember-wash',
  '--faint',
  '--focus-ring',
  '--font',
  '--font-mono',
  '--font-sans',
  '--font-serif',
  '--hover',
  '--iris',
  '--iris-fill',
  '--iris-glow',
  '--iris-lift',
  '--iris-press',
  '--iris-wash',
  '--line',
  '--line-1',
  '--line-2',
  '--line-3',
  '--line-soft',
  '--line-strong',
  '--mantine-font-family',
  '--mantine-font-family-monospace',
  '--mint',
  '--mono',
  '--motion-fast',
  '--motion-standard',
  '--muted',
  '--ok',
  '--ok-fg',
  '--on-iris',
  '--overlay-backdrop',
  '--panel',
  '--radius',
  '--radius-control',
  '--radius-overlay',
  '--radius-sm',
  '--radius-surface',
  '--rail',
  '--sage',
  '--sans',
  '--selected',
  '--serif',
  '--shadow',
  '--shadow-overlay',
  '--sidebar',
  '--sky',
  '--slab',
  '--slab-active',
  '--slab-chip',
  '--slab-hover',
  '--slab-line',
  '--slab-placeholder',
  '--slab-raised',
  '--slab-text',
  '--slab-text-2',
  '--slab-text-3',
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
  '--surface-1',
  '--surface-2',
  '--surface-3',
  '--surface-4',
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
  '--text-1',
  '--text-2',
  '--text-3',
  '--text-4',
  '--user-bubble',
  '--violet',
  '--void',
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

const INK_WASH_ASSET_VARIABLES = [
  '--ink-wash-hero',
  '--ink-wash-conversation-texture',
  '--ink-wash-sidebar-bg',
  '--ink-wash-right-panel-bg',
  '--ink-wash-agent-seal',
  '--ink-wash-dry-brush-divider',
  '--ink-wash-empty-session',
  '--ink-wash-empty-files',
  '--ink-wash-empty-failure',
  '--ink-wash-empty-complete',
];

/**
 * Aliases deleted in earlier passes; re-introducing them must fail the suite.
 * Stored without the `--` prefix so the repo-wide grep gate for the removed
 * names keeps returning zero hits, including in this file.
 */
const REMOVED_LEGACY_ALIASES = ['blue', 'panel-2'].map((name) => `--${name}`);

/** Geometry lives in styles/tokens.css; the runtime must not write it inline. */
const GEOMETRY_VARIABLES = [
  '--topbar-height',
  '--titleband-height',
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

const read = (name: string): string => document.documentElement.style.getPropertyValue(name).trim();

describe('applyAppearanceToDocument', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    delete document.documentElement.dataset.themeMode;
    delete document.documentElement.dataset.themeId;
  });

  it('emits the full documented variable set for Obsidian', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);

    expect(emittedVariableNames(document.documentElement.style)).toEqual([
      ...DOCUMENTED_APPEARANCE_VARIABLES,
    ]);
    for (const name of DOCUMENTED_APPEARANCE_VARIABLES) {
      expect(read(name), `obsidian ${name}`).not.toBe('');
    }
  });

  it('emits the full documented variable set for Bone', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_BONE);

    expect(emittedVariableNames(document.documentElement.style)).toEqual([
      ...DOCUMENTED_APPEARANCE_VARIABLES,
    ]);
    for (const name of DOCUMENTED_APPEARANCE_VARIABLES) {
      expect(read(name), `bone ${name}`).not.toBe('');
    }
  });

  it('emits the same set for a twelve-token theme package, plus its assets', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_INK_WASH);

    const emitted = emittedVariableNames(document.documentElement.style);
    expect(emitted.filter((name) => !INK_WASH_ASSET_VARIABLES.includes(name))).toEqual([
      ...DOCUMENTED_APPEARANCE_VARIABLES,
    ]);
    for (const name of INK_WASH_ASSET_VARIABLES) {
      expect(read(name), `ink-wash ${name}`).not.toBe('');
    }
    expect(document.documentElement.dataset.themeId).toBe('piwin-ink-wash');
    expect(document.documentElement.dataset.themeVisualStyle).toBe('ink-wash');
  });

  it('clears theme-package image variables when switching to a built-in', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_INK_WASH);
    expect(read('--ink-wash-hero')).not.toBe('');

    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);
    for (const name of INK_WASH_ASSET_VARIABLES) {
      expect(read(name), name).toBe('');
    }
  });

  it('makes theme switching a value swap only — identical variable-name sets', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);
    const darkNames = emittedVariableNames(document.documentElement.style);
    const darkField = read('--void');

    applyAppearanceToDocument(PIWIN_APPEARANCE_BONE);

    expect(emittedVariableNames(document.documentElement.style)).toEqual(darkNames);
    expect(read('--void')).not.toBe(darkField);
  });

  it('does not emit removed legacy aliases', () => {
    for (const manifest of BUILTIN_APPEARANCES) {
      applyAppearanceToDocument(manifest);
      for (const alias of REMOVED_LEGACY_ALIASES) {
        expect(read(alias), `${manifest.id} ${alias}`).toBe('');
      }
    }
  });

  it('leaves Inkstone slab tokens to the stylesheet, not Deck surface-3', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);
    expect(read('--slab')).toBe(read('--surface-3'));

    applyAppearanceToDocument(PIWIN_APPEARANCE_INKSTONE_PAPER);
    expect(read('--slab')).toBe('');
    expect(read('--slab-placeholder')).toBe('');

    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);
    expect(read('--slab')).toBe(read('--surface-3'));
  });

  it('strips inline geometry variables written by older builds', () => {
    for (const name of GEOMETRY_VARIABLES) {
      document.documentElement.style.setProperty(name, '999px');
    }

    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);

    for (const name of GEOMETRY_VARIABLES) {
      expect(read(name), name).toBe('');
    }
  });

  it('maps Appearance overlay ids onto Inkstone paper/ink so structural CSS matches', () => {
    applyAppearanceToDocument(
      buildAppearanceTheme('light', {
        preset: 'default',
        background: '#E6E1D7',
        foreground: '#1D1B17',
        accent: '#C6412A',
      }),
    );
    expect(document.documentElement.dataset.themeId).toBe('piwin-inkstone-paper');

    applyAppearanceToDocument(
      buildAppearanceTheme('dark', {
        preset: 'default',
        background: '#0A0A12',
        foreground: '#F2F2FF',
        accent: '#FF4488',
      }),
    );
    expect(document.documentElement.dataset.themeId).toBe('piwin-inkstone-ink');
  });

  it('sets theme identity attributes for every built-in', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);
    expect(document.documentElement.dataset.themeMode).toBe('dark');
    expect(document.documentElement.dataset.themeId).toBe('piwin-obsidian');
    expect(document.documentElement.style.colorScheme).toBe('dark');

    applyAppearanceToDocument(PIWIN_APPEARANCE_BONE);
    expect(document.documentElement.dataset.themeMode).toBe('light');
    expect(document.documentElement.dataset.themeId).toBe('piwin-bone');
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});

describe('Deck ramp projection', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('projects the authored Obsidian ramp', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);

    expect(read('--void')).toBe('#08080b');
    expect(read('--surface-1')).toBe('#101014');
    expect(read('--surface-2')).toBe('#141419');
    expect(read('--surface-3')).toBe('#1a1a21');
    expect(read('--surface-4')).toBe('#22222b');
    expect(read('--text-1')).toBe('#ededf2');
    expect(read('--text-3')).toBe('#898993');
    expect(read('--iris')).toBe('#6e5dff');
    expect(read('--ember')).toBe('#ff8a4c');
  });

  it('projects the authored Bone ramp with a field darker than every surface', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_BONE);

    expect(read('--void')).toBe('#e5e2dc');
    expect(read('--surface-1')).toBe('#f3f1ed');
    expect(read('--surface-3')).toBe('#ffffff');
    expect(read('--iris')).toBe('#5b4bd6');
    expect(read('--on-iris')).toBe('#ffffff');
  });

  it('projects Inkstone paper with a void darker than the panel surface', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_INKSTONE_PAPER);

    expect(read('--void')).toBe('#e6e1d7');
    expect(read('--surface-1')).toBe('#f0ece4');
    expect(read('--void')).not.toBe(read('--surface-1'));
    expect(PIWIN_APPEARANCE_INKSTONE_PAPER.deck?.void).not.toBe(
      PIWIN_APPEARANCE_INKSTONE_PAPER.deck?.surface1,
    );
  });

  it('keeps Inkstone Latin system sans ahead of PingFang so CJK is a fallback, not the Latin face', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_INKSTONE_PAPER);

    const sans = read('--font');
    expect(sans.startsWith('Inter')).toBe(true);
    expect(sans.indexOf('-apple-system')).toBeGreaterThan(0);
    expect(sans.indexOf('-apple-system')).toBeLessThan(sans.indexOf('PingFang'));
    expect(read('--font-mono')).toMatch(/^"JetBrains Mono"/);
  });

  it('prepends custom fonts when provided to applyAppearanceToDocument', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_INKSTONE_PAPER, {
      sansFont: 'Sans Variable',
      monoFont: 'Mono Web',
      serifFont: 'Serif Variable',
    });

    const sans = read('--font');
    expect(sans.startsWith('"Sans Variable"')).toBe(true);
    expect(read('--font-mono').startsWith('"Mono Web"')).toBe(true);
    expect(read('--serif').startsWith('"Serif Variable"')).toBe(true);
    expect(document.documentElement.style.fontFamily).toContain('"Sans Variable"');
  });

  it('maps every legacy surface name onto a Deck role', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);

    // Chrome columns share surface 1; the stage is surface 2; raised cards are 3.
    expect(read('--sidebar')).toBe(read('--surface-1'));
    expect(read('--rail')).toBe(read('--surface-1'));
    expect(read('--canvas')).toBe(read('--surface-2'));
    expect(read('--card')).toBe(read('--surface-3'));
    expect(read('--composer')).toBe(read('--surface-3'));
    // Terminals and code sit in the field, reading as a window not a card.
    expect(read('--term-bg')).toBe(read('--void'));
    expect(read('--accent')).toBe(read('--iris'));
  });

  it('routes the running state to ember, not the accent', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);

    expect(read('--state-running')).toBe(read('--ember'));
    expect(read('--state-running')).not.toBe(read('--accent'));
  });

  it('keeps elevation as a rim light plus a hairline, never a plain border', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_OBSIDIAN);

    expect(read('--elev-1')).toContain('inset 0 1px 0');
    expect(read('--elev-3')).toContain('inset 0 1px 0');
    expect(read('--elev-3')).toContain('0 0 0 1px');
  });
});

describe('deriveDeckTokens', () => {
  const twelveTokenTheme: ThemeManifest = {
    id: 'third-party',
    name: 'Third Party',
    version: '1.0.0',
    mode: 'dark',
    tokens: {
      bg: '#202030',
      panel: '#282838',
      panel2: '#303044',
      border: 'rgba(255, 255, 255, 0.08)',
      text: '#f0f0ff',
      muted: '#9090b0',
      accent: '#40c0a0',
      accent2: '#60d0b8',
      danger: '#e04050',
      ok: '#30b070',
      radius: '10px',
      font: 'system-ui',
    },
  };

  it('synthesises a full ramp for a theme that ships no deck block', () => {
    const deck = deriveDeckTokens(twelveTokenTheme);

    expect(deck.iris).toBe('#40c0a0');
    expect(deck.mint).toBe('#30b070');
    expect(deck.coral).toBe('#e1505f');
    expect(deck.text1).toBe('#f0f0ff');
    expect(deck.text2).toBe('#a0a0be');
  });

  it('places the field behind every surface', () => {
    const deck = deriveDeckTokens(twelveTokenTheme);

    // `bg` is the field the deck floats over and `panel` is the first surface
    // on top of it — the same mapping deck-palette.ts uses on the way out.
    // Reading `bg` as surface1 instead would leave panels sitting directly on
    // the canvas with nothing behind them.
    expect(deck.void).toBe('#202030');
    expect(deck.surface1).toBe('#282838');
    expect(deck.surface3).toBe('#303044');
    expect(deck.void).not.toBe(deck.surface1);
  });

  it('keeps semantic signals a theme cannot express', () => {
    // Ember is a product signal, not a theme choice: a third-party palette must
    // not be able to make "the agent is running" mean some other color.
    expect(deriveDeckTokens(twelveTokenTheme).ember).toBe('#ff8a4c');
    expect(deriveDeckTokens({ ...twelveTokenTheme, mode: 'light' }).ember).toBe('#dd6318');
  });

  it('picks a readable foreground for the accent', () => {
    expect(deriveDeckTokens(twelveTokenTheme).onIris).toBe('#141414');
    expect(
      deriveDeckTokens({
        ...twelveTokenTheme,
        tokens: { ...twelveTokenTheme.tokens, accent: '#2b1a8a' },
      }).onIris,
    ).toBe('#ffffff');
  });
});

describe('theme identity and migration', () => {
  it('keeps builtin ids stable for stored settings', () => {
    expect(PIWIN_APPEARANCE_OBSIDIAN.id).toBe('piwin-obsidian');
    expect(PIWIN_APPEARANCE_BONE.id).toBe('piwin-bone');
    expect(PIWIN_APPEARANCE_INK_WASH.id).toBe('piwin-ink-wash');
    expect(PIWIN_APPEARANCE_OBSIDIAN.name).toBe('Obsidian');
    expect(PIWIN_APPEARANCE_BONE.name).toBe('Bone');
  });

  it('aliases the mode-named exports onto the Deck built-ins', () => {
    expect(PIWIN_APPEARANCE_DARK).toBe(PIWIN_APPEARANCE_INKSTONE_INK);
    expect(PIWIN_APPEARANCE_LIGHT).toBe(PIWIN_APPEARANCE_INKSTONE_PAPER);
  });

  it('migrates retired theme ids so existing installs still resolve', () => {
    expect(migrateThemeId('piwin-dark')).toBe('piwin-inkstone-ink');
    expect(migrateThemeId('piwin-obsidian')).toBe('piwin-inkstone-ink');
    expect(migrateThemeId('piwin-light')).toBe('piwin-inkstone-paper');
    expect(migrateThemeId('piwin-bone')).toBe('piwin-inkstone-paper');
    expect(migrateThemeId('piwin-orange-white')).toBe('piwin-inkstone-paper');
    expect(migrateThemeId('piwin-ink-wash')).toBe('piwin-ink-wash');
    expect(migrateThemeId('some-installed-theme')).toBe('some-installed-theme');
  });

  it('sends Host catalog ids so Deck faces do not ENOENT missing theme folders', () => {
    expect(toHostCatalogThemeId('piwin-obsidian')).toBe('piwin-dark');
    expect(toHostCatalogThemeId('piwin-bone')).toBe('piwin-light');
    expect(toHostCatalogThemeId('piwin-ink-wash')).toBe('piwin-ink-wash');
    expect(toHostCatalogThemeId('piwin-dark')).toBe('piwin-dark');
  });

  it('resolves retired ids to their replacement manifest', () => {
    expect(resolveBuiltinAppearance('piwin-dark')).toBe(PIWIN_APPEARANCE_INKSTONE_INK);
    expect(resolveBuiltinAppearance('piwin-orange-white')).toBe(PIWIN_APPEARANCE_INKSTONE_PAPER);
    expect(resolveBuiltinAppearance(PIWIN_INKSTONE_THEME_ID, 'dark')).toBe(
      PIWIN_APPEARANCE_INKSTONE_INK,
    );
    expect(resolveBuiltinAppearance(undefined)).toBe(PIWIN_APPEARANCE_INKSTONE_INK);
  });

  it('recognises built-in ids including retired ones', () => {
    expect(isBuiltinAppearanceId('piwin-obsidian')).toBe(true);
    expect(isBuiltinAppearanceId('piwin-light')).toBe(true);
    expect(isBuiltinAppearanceId(PIWIN_INKSTONE_THEME_ID)).toBe(true);
    expect(isBuiltinAppearanceId('installed-theme')).toBe(false);
  });

  it('treats product faces as Appearance-owned so Host bootstrap will not restomp them', () => {
    expect(isAppearanceFaceId('piwin-obsidian')).toBe(true);
    expect(isAppearanceFaceId('piwin-dark')).toBe(true);
    expect(isAppearanceFaceId('piwin-bone')).toBe(true);
    expect(isAppearanceFaceId('piwin-light')).toBe(true);
    expect(isAppearanceFaceId('piwin-inkstone-paper')).toBe(true);
    expect(isAppearanceFaceId('piwin-inkstone-ink')).toBe(true);
    expect(isAppearanceFaceId(PIWIN_INKSTONE_THEME_ID)).toBe(true);
    expect(isAppearanceFaceId('piwin-dark-appearance')).toBe(true);
    expect(isAppearanceFaceId('piwin-ink-wash')).toBe(false);
    expect(isAppearanceFaceId('community-nord')).toBe(false);
    expect(isInkstoneThemeId('piwin-dark-appearance')).toBe(true);
    expect(isInkstoneThemeId('piwin-ink-wash')).toBe(false);
  });

  it('prefers the desktop manifest for built-ins and passes installed themes through', () => {
    const stale: ThemeManifest = { ...PIWIN_APPEARANCE_OBSIDIAN, version: '0.0.1' };
    expect(resolveDesktopAppearance(stale)).toBe(PIWIN_APPEARANCE_INKSTONE_INK);

    const installed: ThemeManifest = { ...PIWIN_APPEARANCE_INK_WASH, id: 'installed-theme' };
    expect(resolveDesktopAppearance(installed)).toBe(installed);
  });
});

describe('buildAppearanceTheme', () => {
  const settings: AppearanceThemeSettings = {
    preset: 'default',
    background: '#0a0a12',
    foreground: '#f2f2ff',
    accent: '#ff4488',
  };

  it('drops the authored ramp so custom colors drive a fresh derivation', () => {
    const theme = buildAppearanceTheme('dark', settings);

    expect(theme.deck).toBeUndefined();
    expect(theme.tokens.bg).toBe('#0a0a12');
    expect(theme.tokens.accent).toBe('#ff4488');
  });

  it('projects the custom accent through every accent-derived variable', () => {
    document.documentElement.removeAttribute('style');
    applyAppearanceToDocument(buildAppearanceTheme('dark', settings));

    expect(read('--iris')).toBe('#ff4488');
    expect(read('--accent')).toBe('#ff4488');
    expect(read('--iris-wash')).toContain('255, 68, 136');
  });
});

describe('beginThemeSwitch', () => {
  it('adds the freeze class so chrome transitions do not smear during a flip', () => {
    document.documentElement.classList.remove('is-theme-switching');
    beginThemeSwitch();
    expect(document.documentElement.classList.contains('is-theme-switching')).toBe(true);
  });
});
