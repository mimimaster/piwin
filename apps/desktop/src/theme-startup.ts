/**
 * Cold-start theme resolution for the first paint.
 *
 * Host is the long-term authority (`theme/get-active`), but connecting is
 * async. Without a local last-theme cache the shell always paints Noir first,
 * then jumps to ink-wash / Paper / custom once Host responds — classic FOUC.
 *
 * Strategy:
 * 1. If we remember a product built-in library theme id, project it immediately
 *    (desktop owns full tokens + assets for those ids).
 * 2. Otherwise rebuild from Appearance prefs (light/dark/system + colors).
 * 3. Host bootstrap still applies custom / installed themes after connect.
 */

import type { ThemeManifest } from '@piwin/contracts';
import {
  buildAppearanceTheme,
  resolveBuiltinAppearance,
  resolveSystemThemeMode,
} from './appearance-tokens';
import {
  loadDesktopPreferences,
  loadLastThemeId,
  saveLastThemeId,
  type AppearanceMode,
} from './ui-preferences';

/** Product built-ins that ship in the desktop bundle (no Host required). */
const STARTUP_BUILTIN_THEME_IDS = new Set([
  'piwin-dark',
  'piwin-light',
  'piwin-orange-white',
  'piwin-ink-wash',
]);

function resolvePreferredThemeMode(appearanceMode: AppearanceMode): 'light' | 'dark' {
  return appearanceMode === 'system' ? resolveSystemThemeMode() : appearanceMode;
}

/** Resolve the best theme for pre-React and DesktopThemeRoot initial state. */
export function resolveStartupAppearance(): ThemeManifest {
  const lastThemeId = loadLastThemeId();
  if (lastThemeId !== null && STARTUP_BUILTIN_THEME_IDS.has(lastThemeId)) {
    return resolveBuiltinAppearance(lastThemeId);
  }

  const preferences = loadDesktopPreferences();
  const activeMode = resolvePreferredThemeMode(preferences.appearanceMode);
  const themeSettings = activeMode === 'light' ? preferences.lightTheme : preferences.darkTheme;
  return buildAppearanceTheme(activeMode, themeSettings);
}

/** Persist the applied theme id so the next cold start can pre-paint correctly. */
export function rememberAppliedTheme(theme: ThemeManifest): void {
  saveLastThemeId(theme.id);
}

/**
 * True when document tokens already match this theme id — callers can skip
 * beginThemeSwitch / re-apply to avoid a second visual flip after Host bootstrap.
 */
export function isDocumentThemeId(themeId: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.documentElement.dataset.themeId === themeId;
}

export function isStartupBuiltinThemeId(themeId: string): boolean {
  return STARTUP_BUILTIN_THEME_IDS.has(themeId);
}
