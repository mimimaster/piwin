/**
 * Instant local appearance flip (same prefs path as Settings, no Host IPC).
 * Theme packages own appearance; the toggle becomes a notice instead of a flip.
 */
import type { ThemeManifest } from '@piwin/contracts';
import type { DesktopLocale } from './desktop-locale';
import {
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  type AppearanceThemeSettings,
  type DesktopPreferences,
} from './ui-preferences';

export type AppearanceTogglePlan =
  | { kind: 'blocked-by-theme-package' }
  | {
      kind: 'apply';
      nextMode: 'light' | 'dark';
      nextPreferences: DesktopPreferences;
      nextThemeSettings: AppearanceThemeSettings;
    };

export function appearanceToggleBlockedNotice(locale: DesktopLocale): string {
  return locale === 'zh-CN'
    ? '当前主题包已接管外观；请在设置 → 外观 → 主题包中切换。'
    : 'The active theme package owns appearance. Switch it from Settings → Appearance → Theme Library.';
}

export function planAppearanceToggle(input: {
  visualStyle: ThemeManifest['visualStyle'];
  mode: ThemeManifest['mode'];
  preferences: DesktopPreferences;
}): AppearanceTogglePlan {
  if (input.visualStyle !== undefined) {
    return { kind: 'blocked-by-theme-package' };
  }
  const nextMode = input.mode === 'light' ? 'dark' : 'light';
  const nextThemeSettings =
    nextMode === 'light'
      ? (input.preferences.lightTheme ?? DEFAULT_LIGHT_THEME_SETTINGS)
      : (input.preferences.darkTheme ?? DEFAULT_DARK_THEME_SETTINGS);
  return {
    kind: 'apply',
    nextMode,
    nextThemeSettings,
    nextPreferences: {
      ...input.preferences,
      appearanceMode: nextMode,
    },
  };
}
