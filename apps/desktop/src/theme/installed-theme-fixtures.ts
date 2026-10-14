/**
 * Test-only installed-theme manifests.
 *
 * These are the retired Obsidian / Bone Deck palettes under neutral ids. The
 * product ships only Inkstone, but user-installed packages still render
 * through the generic Deck path, and these authored ramps are the reference
 * the derivation / application tests check that path against.
 */

import type { ThemeDeckTokens, ThemeManifest } from '@piwin/contracts';

import { toManifestTokens } from './deck-palette.js';

const INSTALLED_DARK_DECK: ThemeDeckTokens = {
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

const INSTALLED_LIGHT_DECK: ThemeDeckTokens = {
  void: '#e5e2dc',
  surface1: '#f3f1ed',
  surface2: '#fbfaf8',
  surface3: '#ffffff',
  surface4: '#ffffff',

  text1: '#17161b',
  text2: '#5c5a66',
  // Mirrors the dark floors against the darkest light surface — surface1,
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
  // The published values sat at 2.7:1 — brighter than the field but not
  // readable on it. Ember, sky, and coral already clear 3:1 and are only ever
  // dots, washes, and rules, so they keep their authored hue.
  mint: '#117d56',
  amber: '#956408',
  coral: '#dc4438',
  sky: '#1a8fd0',
};

function installedTheme(
  id: string,
  name: string,
  mode: ThemeManifest['mode'],
  deck: ThemeDeckTokens,
): ThemeManifest {
  return {
    id,
    name,
    version: '1.0.0',
    mode,
    tokens: toManifestTokens(deck),
    deck,
    artifact: {
      bg: 'transparent',
      surface: deck.surface3,
      text: deck.text1,
      muted: deck.text2,
      accent: deck.iris,
      border: deck.line2,
      radius: '0.625rem',
      font: toManifestTokens(deck).font,
    },
  };
}

export const INSTALLED_DARK_THEME = installedTheme(
  'test-installed-dark',
  'Installed Dark',
  'dark',
  INSTALLED_DARK_DECK,
);

export const INSTALLED_LIGHT_THEME = installedTheme(
  'test-installed-light',
  'Installed Light',
  'light',
  INSTALLED_LIGHT_DECK,
);
