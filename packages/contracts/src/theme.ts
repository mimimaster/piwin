/** Theme package contracts — tokens only, no executable CSS/JS payloads. */

export type ThemeColorTokens = {
  bg: string;
  panel: string;
  panel2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
  danger: string;
  ok: string;
  radius: string;
  font: string;
};

export type ThemeManifest = {
  id: string;
  name: string;
  version: string;
  description?: string;
  mode: 'dark' | 'light';
  /** Optional product-owned visual layer; absent means token-only rendering. */
  visualStyle?: 'flat' | 'paper' | 'ink-wash';
  tokens: ThemeColorTokens;
  /** Maps to @piwin/artifact theme CSS variables. */
  artifact?: Partial<{
    bg: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    border: string;
    radius: string;
    font: string;
  }>;
};

export type ThemeSummary = {
  id: string;
  name: string;
  version: string;
  mode: 'dark' | 'light';
  path: string;
  source: 'bundled' | 'user';
  active: boolean;
};

export type ThemePreference = {
  activeThemeId: string;
};
