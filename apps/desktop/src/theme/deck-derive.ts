/**
 * Derive a Deck palette from a twelve-token theme manifest.
 *
 * Installed theme packages implement `ThemeColorTokens` only, so the shell has
 * to synthesise the layered surface/content/signal ramp for them. Product
 * built-ins skip this entirely by authoring `manifest.deck` directly.
 *
 * The derivation preserves the theme's hue and contrast intent: surfaces step
 * away from `bg` in the direction of the mode, and signal colors reuse the
 * manifest's own `ok` / `danger` where the theme expressed an opinion.
 */

import type { ThemeDeckTokens, ThemeManifest } from '@piwin/contracts';
import { alpha, darken, lighten, mix, readableOn } from './color.js';

/** Semantic signals a twelve-token manifest cannot express. */
const SIGNALS = {
  dark: { ember: '#ff8a4c', amber: '#f5b544', sky: '#4cc2ff' },
  light: { ember: '#dd6318', amber: '#c7860b', sky: '#1a8fd0' },
} as const;

export function deriveDeckTokens(manifest: ThemeManifest): ThemeDeckTokens {
  const { tokens, mode } = manifest;
  const isLight = mode === 'light';
  const signals = isLight ? SIGNALS.light : SIGNALS.dark;

  // Read the surface ladder back out of the three slots that carry it, rather
  // than re-inventing it from `bg`. The projection in `deck-palette.ts` sends
  // void→bg, surface1→panel and surface3→panel2, so this is its inverse; the
  // earlier version mapped `bg` onto surface1 and synthesised a darker void
  // below it, which slid every layer down one step on the round trip and left
  // panels sitting on what should have been the field.
  //
  // surface2 and surface4 have no slot in the twelve-token contract, so they
  // are the only steps that must be interpolated back.
  const surface1 = tokens.panel;
  const surface2 = mix(tokens.panel, tokens.panel2, 0.5);
  const surface3 = tokens.panel2;
  const surface4 = isLight ? '#ffffff' : lighten(tokens.panel2, 0.04);

  // The content ramp interpolates the theme's own text→muted direction two
  // steps further toward the canvas rather than inventing new greys.
  const text3 = mix(tokens.muted, tokens.bg, 0.42);
  const text4 = mix(tokens.muted, tokens.bg, 0.66);

  const strokeBase = isLight ? '#141420' : '#ffffff';

  return {
    void: tokens.bg,
    surface1,
    surface2,
    surface3,
    surface4,

    text1: tokens.text,
    text2: tokens.muted,
    text3,
    text4,

    line1: alpha(strokeBase, isLight ? 0.06 : 0.055),
    line2: alpha(strokeBase, isLight ? 0.1 : 0.09),
    line3: alpha(strokeBase, isLight ? 0.17 : 0.15),

    iris: tokens.accent,
    irisLift: tokens.accent2,
    irisPress: darken(tokens.accent, 0.16),
    onIris: readableOn(tokens.accent),

    ember: signals.ember,
    mint: tokens.ok,
    amber: signals.amber,
    coral: tokens.danger,
    sky: signals.sky,
  };
}

/** Authored palette when the manifest declares one, derived otherwise. */
export const resolveDeckTokens = (manifest: ThemeManifest): ThemeDeckTokens =>
  manifest.deck ?? deriveDeckTokens(manifest);
