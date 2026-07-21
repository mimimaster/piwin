/** Built-in dark / light appearance. Shared by shell CSS vars and artifact mapping. */

import type { ThemeManifest } from '@piwin/contracts';

const SHARED_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

/** Product dark — matches docs/ui-prototype.html */
export const PIWIN_APPEARANCE_DARK: ThemeManifest = {
  id: 'piwin-dark',
  name: 'Piwin Dark',
  version: '2.0.0',
  description: 'Default dark chrome for piwin shell + artifacts',
  mode: 'dark',
  tokens: {
    bg: '#090b0f',
    panel: '#11151d',
    panel2: '#171c25',
    border: '#293241',
    text: '#eef2f8',
    muted: '#8792a5',
    accent: '#7ca8ff',
    accent2: '#5d8df6',
    danger: '#ff7b72',
    ok: '#66d49b',
    radius: '10px',
    font: SHARED_FONT,
  },
  artifact: {
    bg: 'transparent',
    surface: 'rgba(23, 28, 37, 0.94)',
    text: '#eef2f8',
    muted: '#8792a5',
    accent: '#7ca8ff',
    border: 'rgba(76, 89, 112, 0.45)',
    radius: '0.75rem',
    font: SHARED_FONT,
  },
};

/** Product light — same structure, inverted surfaces */
export const PIWIN_APPEARANCE_LIGHT: ThemeManifest = {
  id: 'piwin-light',
  name: 'Piwin Light',
  version: '2.0.0',
  description: 'Default light chrome for piwin shell + artifacts',
  mode: 'light',
  tokens: {
    bg: '#f3f5f9',
    panel: '#ffffff',
    panel2: '#eef1f7',
    border: '#d5dbe8',
    text: '#111827',
    muted: '#5f6b7c',
    accent: '#3b6ff5',
    accent2: '#2f5de0',
    danger: '#dc2626',
    ok: '#16a34a',
    radius: '10px',
    font: SHARED_FONT,
  },
  artifact: {
    bg: 'transparent',
    surface: 'rgba(255, 255, 255, 0.96)',
    text: '#111827',
    muted: '#5f6b7c',
    accent: '#3b6ff5',
    border: 'rgba(17, 24, 39, 0.12)',
    radius: '0.75rem',
    font: SHARED_FONT,
  },
};

export const BUILTIN_APPEARANCES: ThemeManifest[] = [
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_LIGHT,
];

export function resolveBuiltinAppearance(themeId: string | undefined): ThemeManifest {
  if (themeId === 'piwin-light') {
    return PIWIN_APPEARANCE_LIGHT;
  }
  return PIWIN_APPEARANCE_DARK;
}

/**
 * Apply theme tokens to document root.
 * Sets legacy --bg/--panel vars and shell layout vars used by the prototype UI.
 */
export function applyAppearanceToDocument(theme: ThemeManifest): void {
  const root = document.documentElement;
  const tokens = theme.tokens;
  const isLight = theme.mode === 'light';

  // Legacy + panel surfaces
  root.style.setProperty('--bg', tokens.bg);
  root.style.setProperty('--canvas', tokens.bg);
  root.style.setProperty('--panel', tokens.panel);
  root.style.setProperty('--panel-2', tokens.panel2);
  root.style.setProperty('--surface', tokens.panel2);
  root.style.setProperty('--surface-raised', isLight ? '#ffffff' : '#1c222d');
  root.style.setProperty('--surface-hover', isLight ? '#e8edf6' : '#222a37');
  root.style.setProperty('--border', tokens.border);
  root.style.setProperty('--line', tokens.border);
  root.style.setProperty(
    '--line-soft',
    isLight ? 'rgba(17, 24, 39, 0.1)' : 'rgba(76, 89, 112, 0.35)',
  );
  root.style.setProperty('--text', tokens.text);
  root.style.setProperty('--muted', tokens.muted);
  root.style.setProperty('--faint', isLight ? '#8b95a7' : '#5d687a');
  root.style.setProperty('--accent', tokens.accent);
  root.style.setProperty('--accent-2', tokens.accent2);
  root.style.setProperty('--blue', tokens.accent);
  root.style.setProperty('--blue-deep', tokens.accent2);
  root.style.setProperty('--violet', isLight ? '#7c6cf0' : '#a790ff');
  root.style.setProperty('--danger', tokens.danger);
  root.style.setProperty('--ok', tokens.ok);
  root.style.setProperty('--green', tokens.ok);
  root.style.setProperty('--radius', tokens.radius);
  root.style.setProperty('--radius-sm', '8px');
  root.style.setProperty('--rail', isLight ? '#eef1f7' : '#0d1016');
  root.style.setProperty('--sidebar', tokens.panel);
  root.style.setProperty(
    '--accent-soft',
    isLight ? 'rgba(59, 111, 245, 0.1)' : 'rgba(124, 168, 255, 0.12)',
  );
  root.style.setProperty(
    '--shadow',
    isLight ? '0 12px 40px rgba(15, 23, 42, 0.08)' : '0 18px 50px rgba(0, 0, 0, 0.45)',
  );
  root.style.setProperty('--font', tokens.font);
  root.style.fontFamily = tokens.font;
  root.dataset.themeMode = theme.mode;
  root.dataset.themeId = theme.id;
  root.style.colorScheme = theme.mode;
}
