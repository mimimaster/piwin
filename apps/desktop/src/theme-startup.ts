/**
 * Cold-start theme resolution for the first paint.
 *
 * Host is the long-term authority (`theme/get-active`), but connecting is
 * async. Without a local last-theme cache the shell would otherwise paint a
 * legacy face first, then jump to Inkstone / ink-wash / custom once Host
 * responds — FOUC.
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
  inkstoneDocumentThemeId,
  isBuiltinAppearanceId,
  isInkstoneThemeId,
  migrateThemeId,
  resolveBuiltinAppearance,
  resolveSystemThemeMode,
} from './appearance-tokens';
import {
  loadDesktopPreferences,
  loadLastThemeId,
  saveLastThemeId,
  type AppearanceMode,
} from './ui-preferences';

function resolvePreferredThemeMode(appearanceMode: AppearanceMode): 'light' | 'dark' {
  return appearanceMode === 'system' ? resolveSystemThemeMode() : appearanceMode;
}

/** Resolve the best theme for pre-React and DesktopThemeRoot initial state. */
export function resolveStartupAppearance(): ThemeManifest {
  const lastThemeId = loadLastThemeId();
  const preferences = loadDesktopPreferences();
  const activeMode = resolvePreferredThemeMode(preferences.appearanceMode);
  if (lastThemeId !== null && isInkstoneThemeId(lastThemeId)) {
    const themeSettings = activeMode === 'light' ? preferences.lightTheme : preferences.darkTheme;
    return buildAppearanceTheme(activeMode, themeSettings);
  }
  if (lastThemeId !== null && isBuiltinAppearanceId(lastThemeId)) {
    return resolveBuiltinAppearance(lastThemeId);
  }

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
 *
 * Both sides are migrated first: Host can still hold a retired built-in id from
 * before the Deck rename, and treating that as a different theme would repaint
 * the shell for no visual change.
 */
export function isDocumentThemeId(themeId: string): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  const applied = document.documentElement.dataset.themeId;
  if (applied === undefined) {
    return false;
  }
  const mode = document.documentElement.dataset.themeMode === 'dark' ? 'dark' : 'light';
  return (
    inkstoneDocumentThemeId(migrateThemeId(applied), mode) ===
    inkstoneDocumentThemeId(migrateThemeId(themeId), mode)
  );
}

export function isStartupBuiltinThemeId(themeId: string): boolean {
  return isBuiltinAppearanceId(themeId);
}
