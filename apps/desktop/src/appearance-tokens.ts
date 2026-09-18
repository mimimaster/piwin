/**
 * Public appearance surface for the desktop shell.
 *
 * Implementation lives in `theme/`:
 *   deck-palette     authored Inkstone / legacy Deck ramps
 *   deck-derive      synthesised ramp for installed twelve-token themes
 *   apply-appearance the single runtime writer of document CSS variables
 *   theme-switch     transition freezing around a flip
 *
 * This file stays a barrel plus the small amount of resolution logic that is
 * specific to *which* theme the desktop should show.
 */

import type { ThemeManifest } from '@piwin/contracts';
import inkWashManifest from '@piwin/theme/bundled/piwin-ink-wash';
import type { AppearanceThemeSettings } from './ui-preferences';
import {
  PIWIN_APPEARANCE_INKSTONE_INK,
  PIWIN_APPEARANCE_INKSTONE_PAPER,
} from './theme/deck-palette';

export {
  applyAppearanceToDocument,
  appearanceVariableNames,
  inkstoneDocumentThemeId,
} from './theme/apply-appearance';
export {
  applyCustomFontsToDocument,
  loadAndRegisterAllCustomFonts,
  type CustomFontPreferences,
} from './theme/font-manager.js';
export { beginThemeSwitch } from './theme/theme-switch';
export { deriveDeckTokens, resolveDeckTokens } from './theme/deck-derive';
export {
  PIWIN_APPEARANCE_BONE,
  PIWIN_APPEARANCE_INKSTONE_INK,
  PIWIN_APPEARANCE_INKSTONE_PAPER,
  PIWIN_APPEARANCE_OBSIDIAN,
} from './theme/deck-palette';

export const PIWIN_INKSTONE_THEME_ID = 'piwin-inkstone';

/** Browser-safe projection of the bundled token-only ink-wash manifest. */
export const PIWIN_APPEARANCE_INK_WASH: ThemeManifest = inkWashManifest as ThemeManifest;

/**
 * Mode-named aliases. The overwhelming majority of call sites — every test that
 * mounts `PiwinUiProvider` — only ever want "the dark one" or "the light one",
 * so these stay stable across palette changes.
 */
export const PIWIN_APPEARANCE_DARK = PIWIN_APPEARANCE_INKSTONE_INK;
export const PIWIN_APPEARANCE_LIGHT = PIWIN_APPEARANCE_INKSTONE_PAPER;

/** Runtime manifests; the user-facing catalog collapses the two Inkstone faces. */
export const BUILTIN_APPEARANCES: ThemeManifest[] = [
  PIWIN_APPEARANCE_INK_WASH,
  PIWIN_APPEARANCE_INKSTONE_PAPER,
  PIWIN_APPEARANCE_INKSTONE_INK,
];

/**
 * Retired built-in ids, mapped onto Inkstone's corresponding face.
 *
 * Theme selection persists in localStorage and in Host settings, so an upgrade
 * would otherwise leave existing installs pointing at a hidden default face.
 */
const RETIRED_THEME_IDS: Record<string, string> = {
  'piwin-dark': 'piwin-inkstone-ink',
  'piwin-obsidian': 'piwin-inkstone-ink',
  'piwin-light': 'piwin-inkstone-paper',
  'piwin-bone': 'piwin-inkstone-paper',
  'piwin-orange-white': 'piwin-inkstone-paper',
};

/** Current id for a possibly-retired one. */
export const migrateThemeId = (themeId: string): string => RETIRED_THEME_IDS[themeId] ?? themeId;

export function isInkstoneThemeId(themeId: string): boolean {
  const id = migrateThemeId(themeId);
  return (
    id === PIWIN_INKSTONE_THEME_ID ||
    id === 'piwin-light-appearance' ||
    id === 'piwin-dark-appearance' ||
    id === 'piwin-inkstone-paper' ||
    id === 'piwin-inkstone-ink'
  );
}

export function resolveInkstoneFaceThemeId(mode: 'light' | 'dark'): string {
  return mode === 'light' ? 'piwin-inkstone-paper' : 'piwin-inkstone-ink';
}

/**
 * Host still installs bundled dirs as `piwin-dark` / `piwin-light`. Send those
 * on `theme/set-active` so an older Host (or a Host that has not remapped Deck
 * faces) does not `open` a folder that is not on disk.
 */
export function toHostCatalogThemeId(themeId: string): string {
  switch (themeId) {
    case 'piwin-obsidian':
      return 'piwin-dark';
    case 'piwin-bone':
      return 'piwin-light';
    default:
      return themeId;
  }
}

/** True when the id names a theme the desktop bundle can paint without Host. */
export function isBuiltinAppearanceId(themeId: string): boolean {
  const id = migrateThemeId(themeId);
  return id === PIWIN_INKSTONE_THEME_ID || BUILTIN_APPEARANCES.some((theme) => theme.id === id);
}

/**
 * Inkstone's day/night faces and the three-color Appearance overrides. Host
 * bootstrap must not re-apply these —
 * they would stomp the user's Appearance prefs. Ink-wash and installed
 * packages are not faces: they are library themes and should flow through.
 */
export function isAppearanceFaceId(themeId: string): boolean {
  if (themeId.endsWith('-appearance')) {
    return true;
  }
  const id = migrateThemeId(themeId);
  return (
    id === PIWIN_INKSTONE_THEME_ID ||
    id === 'piwin-inkstone-paper' ||
    id === 'piwin-inkstone-ink'
  );
}

/** Installed visual packages own their colors; built-in product faces can flip. */
export function isThemeAppearanceLocked(theme: Pick<ThemeManifest, 'id' | 'visualStyle'>): boolean {
  return theme.visualStyle !== undefined && !isAppearanceFaceId(theme.id);
}

export function resolveBuiltinAppearance(
  themeId: string | undefined,
  mode?: 'light' | 'dark',
): ThemeManifest {
  switch (themeId === undefined ? '' : migrateThemeId(themeId)) {
    case 'piwin-ink-wash':
      return PIWIN_APPEARANCE_INK_WASH;
    case PIWIN_INKSTONE_THEME_ID:
      return mode === 'dark' ? PIWIN_APPEARANCE_INKSTONE_INK : PIWIN_APPEARANCE_INKSTONE_PAPER;
    case 'piwin-inkstone-paper':
      return PIWIN_APPEARANCE_INKSTONE_PAPER;
    case 'piwin-inkstone-ink':
      return PIWIN_APPEARANCE_INKSTONE_INK;
    default:
      return PIWIN_APPEARANCE_INKSTONE_PAPER;
  }
}

/**
 * Built-in ids are product-owned visual contracts: always paint the desktop's
 * own manifest for them rather than an older copy the Host may have cached.
 * Installed themes keep their own validated tokens.
 */
export function resolveDesktopAppearance(theme: ThemeManifest): ThemeManifest {
  return isBuiltinAppearanceId(theme.id) ? resolveBuiltinAppearance(theme.id, theme.mode) : theme;
}

/** Resolve the browser system preference without making SSR/test assumptions. */
export function resolveSystemThemeMode(): 'light' | 'dark' {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'light';
}

/**
 * Apply the user's Appearance settings (background / foreground / accent) on
 * top of a Deck base.
 *
 * Only the three colors the settings page exposes are overridden; the rest of
 * the Deck ramp is re-derived from them so a custom accent still produces
 * coherent washes, glows, and focus rings.
 */
export function buildAppearanceTheme(
  mode: 'light' | 'dark',
  settings: AppearanceThemeSettings,
): ThemeManifest {
  const base =
    mode === 'light' ? PIWIN_APPEARANCE_INKSTONE_PAPER : PIWIN_APPEARANCE_INKSTONE_INK;
  // Default colors must retain the authored manifest identity: structural
  // Inkstone selectors and the dark slab depend on it, not just the colors.
  if (
    settings.background.toLowerCase() === base.tokens.bg.toLowerCase() &&
    settings.foreground.toLowerCase() === base.tokens.text.toLowerCase() &&
    settings.accent.toLowerCase() === base.tokens.accent.toLowerCase()
  ) {
    return base;
  }
  // Built without spreading `base`, so the authored `deck` ramp is absent and
  // the custom colors drive a fresh derivation instead of being half-overridden.
  return {
    id: `piwin-${mode}-appearance`,
    name: mode === 'light' ? 'Custom Light' : 'Custom Dark',
    version: base.version,
    description: `Deck ${mode} with user-selected background, foreground, and accent`,
    mode,
    tokens: {
      ...base.tokens,
      bg: settings.background,
      text: settings.foreground,
      accent: settings.accent,
      accent2: settings.accent,
    },
    artifact: {
      ...base.artifact,
      bg: settings.background,
      text: settings.foreground,
      accent: settings.accent,
    },
  };
}
