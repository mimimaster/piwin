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
export const INKSTONE_PAPER_DECK: ThemeDeckTokens = {
  void: '#e4e3df',
  surface1: '#efeeeb',
  surface2: '#f8f7f5',
  surface3: '#fefdfb',
  surface4: '#ffffff',

  text1: '#1b1b19',
  text2: '#565552',
  text3: '#6c6b68',
  text4: '#898884',

  line1: 'rgba(27, 27, 25, 0.06)',
  line2: 'rgba(27, 27, 25, 0.11)',
  line3: 'rgba(27, 27, 25, 0.2)',

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
 * Inkstone (砚) — Modern face (现代冷白 / 方案一).
 * Clean, neutral, glare-free modern light surface (Linear / GitHub / macOS native inspired).
 * Pure slate cool-grey, high contrast, zero colored wash on void/surfaces.
 */
export const INKSTONE_MODERN_DECK: ThemeDeckTokens = {
  void: '#e5e6e8',
  surface1: '#eff0f2',
  surface2: '#f8f9fa',
  surface3: '#ffffff',
  surface4: '#ffffff',

  text1: '#16181d',
  text2: '#52555a',
  text3: '#6f7177',
  text4: '#a0a2a7',

  line1: 'rgba(22, 24, 29, 0.05)',
  line2: 'rgba(22, 24, 29, 0.09)',
  line3: 'rgba(22, 24, 29, 0.15)',

  iris: '#16181d',
  irisLift: '#262930',
  irisPress: '#0b0c0f',
  onIris: '#ffffff',

  ember: '#d97706',
  mint: '#16a34a',
  amber: '#b45309',
  coral: '#dc2626',
  sky: '#0284c7',
};

/** Backwards-compatibility aliases to heal any prior colored presets into modern */
export const INKSTONE_CELADON_DECK = INKSTONE_MODERN_DECK;
export const INKSTONE_MICA_DECK = INKSTONE_MODERN_DECK;
export const INKSTONE_MIST_DECK = INKSTONE_MODERN_DECK;

/**
 * Inkstone (砚) — ink face.
 *
 * The same semantic channels as Paper on a deep-night surface. Keep this a
 * real counterpart, not a generic dark mode, so switching faces preserves the
 * meaning of every status color and action.
 */
const INKSTONE_INK_DECK: ThemeDeckTokens = {
  void: '#0b0b0a',
  surface1: '#121211',
  surface2: '#171716',
  surface3: '#1e1d1c',
  surface4: '#272624',

  text1: '#e7e6e3',
  text2: '#a09f9c',
  text3: '#868582',
  text4: '#666562',

  line1: 'rgba(231, 230, 227, 0.06)',
  line2: 'rgba(231, 230, 227, 0.1)',
  line3: 'rgba(231, 230, 227, 0.17)',

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

export const PIWIN_APPEARANCE_INKSTONE_MODERN: ThemeManifest = {
  id: 'piwin-inkstone-paper-modern',
  name: 'Inkstone · 现代冷白',
  version: '1.0.0',
  description: 'Inkstone (砚) light face — pure clean slate, electric indigo, glare-free modern',
  mode: 'light',
  visualStyle: 'paper',
  tokens: toManifestTokens(INKSTONE_MODERN_DECK),
  deck: INKSTONE_MODERN_DECK,
  artifact: {
    bg: 'transparent',
    surface: INKSTONE_MODERN_DECK.surface3,
    text: INKSTONE_MODERN_DECK.text1,
    muted: INKSTONE_MODERN_DECK.text2,
    accent: INKSTONE_MODERN_DECK.iris,
    border: INKSTONE_MODERN_DECK.line2,
    radius: '0.625rem',
    font: FONT_SANS,
  },
};

/** Compatibility manifests for historical IDs: alias to modern to prevent green tint */
export const PIWIN_APPEARANCE_INKSTONE_CELADON: ThemeManifest = PIWIN_APPEARANCE_INKSTONE_MODERN;
export const PIWIN_APPEARANCE_INKSTONE_MICA: ThemeManifest = PIWIN_APPEARANCE_INKSTONE_MODERN;
export const PIWIN_APPEARANCE_INKSTONE_MIST: ThemeManifest = PIWIN_APPEARANCE_INKSTONE_MODERN;

export type InkstoneLightPresetId = 'modern' | 'paper' | 'celadon' | 'mica' | 'mist';

export type InkstoneLightPresetMeta = {
  id: 'modern' | 'paper';
  nameZh: string;
  nameEn: string;
  descriptionZh: string;
  descriptionEn: string;
  manifest: ThemeManifest;
  slabBg: string;
};

export const INKSTONE_LIGHT_PRESETS: readonly InkstoneLightPresetMeta[] = [
  {
    id: 'modern',
    nameZh: '现代冷白',
    nameEn: 'Modern Slate',
    descriptionZh: '纯净极简 · 方案一',
    descriptionEn: 'Clean Slate · Modern',
    manifest: PIWIN_APPEARANCE_INKSTONE_MODERN,
    slabBg: '#16181d',
  },
  {
    id: 'paper',
    nameZh: '经典宣纸',
    nameEn: 'Classic Paper',
    descriptionZh: '暖润宣纸 · 原版',
    descriptionEn: 'Warm Paper · Classic',
    manifest: PIWIN_APPEARANCE_INKSTONE_PAPER,
    slabBg: '#1c1b19',
  },
] as const;

export function resolveInkstoneLightPreset(presetId: string): InkstoneLightPresetMeta {
  if (presetId === 'paper') {
    return INKSTONE_LIGHT_PRESETS[1]!;
  }
  return INKSTONE_LIGHT_PRESETS[0]!;
}

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
