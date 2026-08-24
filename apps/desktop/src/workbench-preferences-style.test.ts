import type { CSSProperties } from 'react';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DARK_THEME_SETTINGS,
  DEFAULT_LIGHT_THEME_SETTINGS,
  type DesktopPreferences,
} from './ui-preferences';
import { appShellCssVars, desktopPreferencesCssVars } from './workbench-preferences-style.js';

const preferences: DesktopPreferences = {
  assistantTextSize: 'small',
  codeTextSize: 'large',
  codeWrap: true,
  conversationWidth: 'wide',
  workDetailsExpanded: 'auto',
  toolDensity: 'comfortable',
  appearanceMode: 'dark',
  verboseAgentChat: false,
  artifactCodeFirst: false,
  lightTheme: DEFAULT_LIGHT_THEME_SETTINGS,
  darkTheme: DEFAULT_DARK_THEME_SETTINGS,
};

describe('desktopPreferencesCssVars', () => {
  it('maps size and wrap prefs onto shell custom properties', () => {
    expect(desktopPreferencesCssVars(preferences)).toMatchObject({
      '--chat-font-size': '13px',
      '--code-font-size': '14.5px',
      '--code-wrap': 'break-word',
    });
  });
});

describe('appShellCssVars', () => {
  it('omits live width vars while a panel is resizing', () => {
    const vars = appShellCssVars({
      preferencesStyle: { '--chat-font-size': '13px' } as CSSProperties,
      sidebarWidthPx: 240,
      sidebarResizing: true,
      rightPanelWidthPx: 360,
      rightPanelResizing: false,
    });
    expect(vars).not.toHaveProperty('--sidebar-width');
    expect(vars).toHaveProperty('--right-panel-width', '360px');
  });
});
