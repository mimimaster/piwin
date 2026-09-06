import { describe, expect, it } from 'vitest';
import {
  appearanceToggleBlockedNotice,
  planAppearanceToggle,
} from './appearance-toggle.js';
import {
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  type DesktopPreferences,
} from './ui-preferences';

const preferences: DesktopPreferences = {
  assistantTextSize: 'default',
  codeTextSize: 'default',
  codeWrap: false,
  conversationWidth: 'default',
  workDetailsExpanded: 'auto',
  toolDensity: 'comfortable',
  appearanceMode: 'dark',
  verboseAgentChat: false,
  artifactCodeFirst: false,
  lightTheme: DEFAULT_LIGHT_THEME_SETTINGS,
  darkTheme: DEFAULT_DARK_THEME_SETTINGS,
};

describe('planAppearanceToggle', () => {
  it.each([
    ['piwin-inkstone-paper', 'light', 'dark'],
    ['piwin-inkstone-ink', 'dark', 'light'],
  ] as const)('switches the %s product face directly', (themeId, mode, nextMode) => {
    expect(planAppearanceToggle({ themeId, mode, visualStyle: 'paper', preferences }))
      .toMatchObject({ kind: 'apply', nextMode });
  });

  it('keeps an installed paper theme under its own appearance authority', () => {
    expect(planAppearanceToggle({
      themeId: 'community-paper', mode: 'light', visualStyle: 'paper', preferences,
    })).toEqual({ kind: 'blocked-by-theme-package' });
  });
  it('blocks the flip when a theme package owns appearance', () => {
    expect(
      planAppearanceToggle({
        visualStyle: 'ink-wash',
        mode: 'dark',
        preferences,
      }),
    ).toEqual({ kind: 'blocked-by-theme-package' });
  });

  it('flips light/dark and keeps the matching theme settings', () => {
    expect(
      planAppearanceToggle({
        visualStyle: undefined,
        mode: 'light',
        preferences: {
          ...preferences,
          appearanceMode: 'light',
          lightTheme: DEFAULT_LIGHT_THEME_SETTINGS,
          darkTheme: DEFAULT_DARK_THEME_SETTINGS,
        },
      }),
    ).toMatchObject({
      kind: 'apply',
      nextMode: 'dark',
      nextThemeSettings: DEFAULT_DARK_THEME_SETTINGS,
      nextPreferences: { appearanceMode: 'dark' },
    });
  });
});

describe('appearanceToggleBlockedNotice', () => {
  it('uses the locale string', () => {
    expect(appearanceToggleBlockedNotice('en')).toContain('Theme Library');
    expect(appearanceToggleBlockedNotice('zh-CN')).toContain('主题包');
  });
});
