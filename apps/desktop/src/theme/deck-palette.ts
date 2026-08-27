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
  text3: '#62626f',
  text4: '#414150',

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
  text3: '#8b8896',
  text4: '#b4b1bc',

  line1: 'rgba(20, 18, 30, 0.06)',
  line2: 'rgba(20, 18, 30, 0.10)',
  line3: 'rgba(20, 18, 30, 0.17)',

  iris: '#5b4bd6',
  irisLift: '#4a3bc4',
  irisPress: '#3f31ad',
  onIris: '#ffffff',

  ember: '#dd6318',
  mint: '#17a672',
  amber: '#c7860b',
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
