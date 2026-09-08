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
 * Obsidian — the default dark face.
 *
 * A cool near-black field with four layered surfaces. Iris carries every
 * affordance; ember is reserved for an actively running agent so a warm pixel
 * anywhere in the shell always means the same thing.
 */
const OBSIDIAN_DECK: ThemeDeckTokens = {
  void: '#08080b',
  surface1: '#101014',
  surface2: '#141419',
  surface3: '#1a1a21',
  surface4: '#22222b',

  text1: '#ededf2',
  text2: '#9a9aa8',
  // text3/text4 are readability floors, not free choices: 318 declarations
  // paint real information with text4 (timestamps, section titles, code
  // gutters, control values), so the bottom of the ramp has to stay legible
  // against the *lightest* surface it lands on — surface4, where menus and
  // tooltips sit. text3 clears 4.5:1 there and text4 clears 3:1.
  text3: '#898993',
  text4: '#6b6b78',

  line1: 'rgba(255, 255, 255, 0.055)',
  line2: 'rgba(255, 255, 255, 0.09)',
  line3: 'rgba(255, 255, 255, 0.15)',

  iris: '#6e5dff',
  irisLift: '#8b7cff',
  irisPress: '#5847e8',
  onIris: '#ffffff',

  ember: '#ff8a4c',
  mint: '#3ecf8e',
  amber: '#f5b544',
  coral: '#ff5f56',
  sky: '#4cc2ff',
};

/**
 * Bone — the light face.
 *
 * `void` is a warm paper grey rather than white: the gaps between panels must
 * read as *behind* the deck, so the field has to be darker than every surface.
 */
const BONE_DECK: ThemeDeckTokens = {
  void: '#e5e2dc',
  surface1: '#f3f1ed',
  surface2: '#fbfaf8',
  surface3: '#ffffff',
  surface4: '#ffffff',

  text1: '#17161b',
  text2: '#5c5a66',
  // Mirrors Obsidian's floors against the darkest light surface — surface1,
  // the chrome columns — so the sidebar's own labels and timestamps read.
  text3: '#6f6d78',
  text4: '#8d8a94',

  line1: 'rgba(20, 18, 30, 0.06)',
  line2: 'rgba(20, 18, 30, 0.10)',
  line3: 'rgba(20, 18, 30, 0.17)',

  iris: '#5b4bd6',
  irisLift: '#4a3bc4',
  irisPress: '#3f31ad',
  onIris: '#ffffff',

  ember: '#dd6318',
  // Mint and amber carry status *text* ("3 additions", "needs your input"), so
  // Text tokens clear WCAG AA 4.5:1 on every paper surface (see
  // styles/inkstone/contrast.test.ts which guards the pairing matrix).
  // The published Bone values sat at 2.7:1 — brighter than the field but not
  // readable on it. Ember, sky, and coral already clear 3:1 and are only ever
  // dots, washes, and rules, so they keep their authored hue.
  mint: '#117d56',
  amber: '#956408',
  coral: '#dc4438',
  sky: '#1a8fd0',
};

/**
 * Project a Deck palette onto the twelve-token manifest contract.
 *
 * `ThemeColorTokens` is the public surface installed themes implement, so the
 * built-ins must populate it too — the artifact renderer and Mantine scale
 * both read from it rather than from `deck`.
 */
function toManifestTokens(deck: ThemeDeckTokens): ThemeManifest['tokens'] {
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

export const PIWIN_APPEARANCE_OBSIDIAN: ThemeManifest = {
  id: 'piwin-obsidian',
  name: 'Obsidian',
  version: '1.0.0',
  description:
    'Deck dark — floating graphite panels over a cool void field, iris affordances, ember run signal',
  mode: 'dark',
  tokens: toManifestTokens(OBSIDIAN_DECK),
  deck: OBSIDIAN_DECK,
  artifact: {
    bg: 'transparent',
    surface: OBSIDIAN_DECK.surface3,
    text: OBSIDIAN_DECK.text1,
    muted: OBSIDIAN_DECK.text2,
    accent: OBSIDIAN_DECK.iris,
    border: OBSIDIAN_DECK.line2,
    radius: '0.625rem',
    font: FONT_SANS,
  },
};

export const PIWIN_APPEARANCE_BONE: ThemeManifest = {
  id: 'piwin-bone',
  name: 'Bone',
  version: '1.0.0',
  description:
    'Deck light — white panels floating over warm paper, iris affordances, ember run signal',
  mode: 'light',
  tokens: toManifestTokens(BONE_DECK),
  deck: BONE_DECK,
  artifact: {
    bg: 'transparent',
    surface: BONE_DECK.surface3,
    text: BONE_DECK.text1,
    muted: BONE_DECK.text2,
    accent: BONE_DECK.iris,
    border: BONE_DECK.line2,
    radius: '0.625rem',
    font: FONT_SANS,
  },
};

/**
 * Inkstone (砚) — paper face.
 *
 * Authored in docs/design/inkstone/01-inkstone-theme.md §3 and validated across
 * seven HTML prototypes (proto-00..07). Vermillion (zhu) is the user's hand —
 * primary actions, focus, pending approval. Lamp (ember-role) is the agent's
 * hand — running work. Never mix the two: a warm-amber pixel always means "the
 * agent is running," a red pixel always means "you can act here."
 */
const INKSTONE_PAPER_DECK: ThemeDeckTokens = {
  void: '#e6e1d7',
  surface1: '#f0ece4',
  surface2: '#f8f6f0',
  surface3: '#fffdf8',
  surface4: '#ffffff',

  text1: '#1d1b17',
  text2: '#5a554d',
  text3: '#655e53',
  text4: '#696256',

  line1: 'rgba(29, 27, 23, 0.06)',
  line2: 'rgba(29, 27, 23, 0.11)',
  line3: 'rgba(29, 27, 23, 0.2)',

  iris: '#b03a24',
  irisLift: '#d4553d',
  irisPress: '#a53420',
  onIris: '#fff7f0',

  ember: '#8a5f0c',
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
  text3: '#968d81',
  text4: '#8d857a',

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
