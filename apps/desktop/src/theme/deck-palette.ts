/**
 * Deck palettes — the product's built-in appearance ramps.
 *
 * Authored values only; no derivation. See docs/design/deck-design-system.md
 * for the reasoning behind each role. Geometry, motion, and elevation are not
 * here: they are product-owned and live in styles/tokens.css so installed
 * themes cannot reshape the shell.
 */

import type { ThemeDeckTokens, ThemeManifest } from '@piwin/contracts';

/** UI sans — upright, geometric neo-grotesque fonts first for precise, square structural feel. */
const FONT_SANS =
  'Inter, "Geist Sans", "Plus Jakarta Sans", "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", system-ui, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

export const FONT_MONO =
  '"JetBrains Mono", "Geist Mono", "Fira Code", "IBM Plex Mono", "SF Mono", Menlo, Consolas, monospace';

/**
 * Project a Deck palette onto the twelve-token manifest contract.
 *
 * `ThemeColorTokens` is the public surface installed themes implement, so the
 * built-ins must populate it too — the artifact renderer and Mantine scale
 * both read from it rather than from `deck`.
 */
export function toManifestTokens(deck: ThemeDeckTokens): ThemeManifest['tokens'] {
  return {
    bg: deck.void,
    panel: deck.surface1,
    panel2: deck.surface3,
    border: deck.line2,
    text: deck.text1,
    muted: deck.text2,
    accent: deck.iris,
    accent2: deck.irisLift,
    danger: deck.coral,
    ok: deck.mint,
    radius: '10px',
    font: FONT_SANS,
  };
}

/**
 * Inkstone (砚) — paper face.
 *
 * Authored in docs/design/inkstone/01-inkstone-theme.md §3 and validated across
 * seven HTML prototypes (proto-00..07). Vermillion (zhu) is the user's hand —
 * primary actions, focus, pending approval. Lamp (ember-role) is the agent's
 * hand — running work. Never mix the two: a warm-amber pixel always means "the
 * agent is running," a red pixel always means "you can act here."
 *
 * These values mirror styles/inkstone/tokens.css, which copies
 * docs/design/inkstone/shell-foundation.css verbatim. The two layers name the
 * same roles twice (--zhu/iris, --lamp/ember, --t1..4/text1..4); they must not
 * disagree. See docs/design/inkstone/09-port-drift.md.
 */
const INKSTONE_PAPER_DECK: ThemeDeckTokens = {
  void: '#e6e1d7',
  surface1: '#f0ece4',
  surface2: '#f8f6f0',
  surface3: '#fffdf8',
  surface4: '#ffffff',

  text1: '#1d1b17',
  text2: '#5a554d',
  text3: '#726b61',
  text4: '#8f887d',

  line1: 'rgba(29, 27, 23, 0.06)',
  line2: 'rgba(29, 27, 23, 0.11)',
  line3: 'rgba(29, 27, 23, 0.2)',

  iris: '#b03a24',
  irisLift: '#d4553d',
  irisPress: '#a53420',
  onIris: '#fff7f0',

  ember: '#b8801f',
  mint: '#3d7c5e',
  amber: '#94611a',
  coral: '#9c2e3d',
  sky: '#3a7797',
};

/**
 * Inkstone (砚) — ink face.
 *
 * The same semantic channels as Paper on a deep-night surface. Keep this a
 * real counterpart, not a generic dark mode, so switching faces preserves the
 * meaning of every status color and action.
 */
const INKSTONE_INK_DECK: ThemeDeckTokens = {
  void: '#0b0a09',
  surface1: '#141210',
  surface2: '#191714',
  surface3: '#201d19',
  surface4: '#2a2621',

  text1: '#ebe5da',
  text2: '#a59d92',
  text3: '#8b8378',
  text4: '#6a6259',

  line1: 'rgba(235, 229, 218, 0.06)',
  line2: 'rgba(235, 229, 218, 0.1)',
  line3: 'rgba(235, 229, 218, 0.17)',

  iris: '#e25a3d',
  irisLift: '#f07054',
  irisPress: '#c94a2f',
  onIris: '#1c0b07',

  ember: '#e7b352',
  mint: '#5fad85',
  amber: '#c88f3c',
  coral: '#d95f6e',
  sky: '#6ba4c3',
};

export const PIWIN_APPEARANCE_INKSTONE_PAPER: ThemeManifest = {
  id: 'piwin-inkstone-paper',
  name: 'Inkstone · 纸',
  version: '1.0.0',
  description:
    'Inkstone (砚) light face — warm paper void, vermillion for your hand, lamp for the agent\u2019s',
  mode: 'light',
  visualStyle: 'paper',
  tokens: toManifestTokens(INKSTONE_PAPER_DECK),
  deck: INKSTONE_PAPER_DECK,
  artifact: {
    bg: 'transparent',
    surface: INKSTONE_PAPER_DECK.surface3,
    text: INKSTONE_PAPER_DECK.text1,
    muted: INKSTONE_PAPER_DECK.text2,
    accent: INKSTONE_PAPER_DECK.iris,
    border: INKSTONE_PAPER_DECK.line2,
    radius: '0.625rem',
    font: FONT_SANS,
  },
};

export const PIWIN_APPEARANCE_INKSTONE_INK: ThemeManifest = {
  id: 'piwin-inkstone-ink',
  name: 'Inkstone · 墨',
  version: '1.0.0',
  description:
    'Inkstone (砚) dark face — deep-night void, vermillion for your hand, lamp for the agent\u2019s',
  mode: 'dark',
  visualStyle: 'paper',
  tokens: toManifestTokens(INKSTONE_INK_DECK),
  deck: INKSTONE_INK_DECK,
  artifact: {
    bg: 'transparent',
    surface: INKSTONE_INK_DECK.surface3,
    text: INKSTONE_INK_DECK.text1,
    muted: INKSTONE_INK_DECK.text2,
    accent: INKSTONE_INK_DECK.iris,
    border: INKSTONE_INK_DECK.line2,
    radius: '0.625rem',
    font: FONT_SANS,
  },
};
