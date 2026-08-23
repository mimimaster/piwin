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

/**
 * Deck palette — the full surface/content/signal ramp used by the desktop
 * shell (docs/design/deck-design-system.md).
 *
 * Optional on the manifest: product built-ins declare it explicitly so the
 * shell's layered depth is authored rather than guessed, while installed theme
 * packages that only ship `ThemeColorTokens` get a derived ramp instead.
 */
export type ThemeDeckTokens = {
  /** The field behind the deck; visible in the gaps between floating panels. */
  void: string;
  /** Chrome panels — rail, sidebar, inspector. */
  surface1: string;
  /** The stage / transcript canvas. */
  surface2: string;
  /** Raised — composer, cards, tool rows, menus. */
  surface3: string;
  /** Highest — dropdowns, tooltips, command palette. */
  surface4: string;

  /** Primary → disabled content ramp. */
  text1: string;
  text2: string;
  text3: string;
  text4: string;

  /** Subtle → emphasis stroke ramp. */
  line1: string;
  line2: string;
  line3: string;

  /** Affordance / focus / primary action. */
  iris: string;
  /** Iris raised for text and icons on dark surfaces. */
  irisLift: string;
  /** Iris pressed state. */
  irisPress: string;
  /** Text and icons on a solid iris fill. */
  onIris: string;

  /** Reserved: the agent is running. Never used for anything else. */
  ember: string;
  /** Completed, added. */
  mint: string;
  /** Needs your input. */
  amber: string;
  /** Failed, destructive. */
  coral: string;
  /** Subagent lane, waiting. */
  sky: string;
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
  /** Authored Deck ramp; derived from `tokens` when absent. */
  deck?: ThemeDeckTokens;
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
