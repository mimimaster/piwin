import type { ArtifactThemeVariables } from '@piwin/artifact';
import { createDefaultArtifactTheme } from '@piwin/artifact';
import type { ThemeManifest } from '@piwin/contracts';
import { resolveDeckTokens } from '../theme/deck-derive';
import { FONT_MONO } from '../theme/deck-palette';

/**
 * Map an active desktop theme package to artifact CSS variables.
 * Prefers theme.artifact overrides when present.
 */
export function mapThemeToArtifactVariables(
  theme: ThemeManifest | null | undefined,
): ArtifactThemeVariables {
  if (!theme) {
    return createDefaultArtifactTheme('dark');
  }

  const artifact = theme.artifact;
  const tokens = theme.tokens;
  const deck = resolveDeckTokens(theme);

  return {
    '--piwin-artifact-theme': theme.mode,
    // The iframe document joins the transcript canvas. Initial paint is gated
    // by ArtifactFrame; making the document opaque creates a page-like block.
    '--piwin-artifact-bg': artifact?.bg ?? 'transparent',
    '--piwin-artifact-surface': artifact?.surface ?? tokens.panel,
    '--piwin-artifact-text': artifact?.text ?? tokens.text,
    '--piwin-artifact-muted': artifact?.muted ?? tokens.muted,
    '--piwin-artifact-accent': artifact?.accent ?? tokens.accent,
    '--piwin-artifact-on-accent-themed': artifact?.onAccent ?? deck.onIris,
    '--piwin-artifact-border': artifact?.border ?? tokens.border,
    '--piwin-artifact-radius': artifact?.radius ?? tokens.radius,
    '--piwin-artifact-font': artifact?.font ?? tokens.font,
    ...mapThemeToArtifactV14Tokens(theme),
  };
}

/**
 * Runtime v14 vocabulary from the Deck ramp (design.md §3). A second layer
 * steps away from the artifact surface: lighter on ink, a sunken well on paper.
 */
function mapThemeToArtifactV14Tokens(theme: ThemeManifest): Partial<ArtifactThemeVariables> {
  const artifact = theme.artifact;
  const deck = resolveDeckTokens(theme);
  const dark = theme.mode === 'dark';
  const text = artifact?.text ?? theme.tokens.text;
  return {
    '--piwin-artifact-surface-2': artifact?.surface2 ?? (dark ? deck.surface4 : deck.surface2),
    '--piwin-artifact-subtle': artifact?.subtle ?? deck.text3,
    '--piwin-artifact-border-strong': artifact?.borderStrong ?? deck.line3,
    '--piwin-artifact-ok': artifact?.ok ?? deck.mint,
    '--piwin-artifact-warn': artifact?.warn ?? deck.amber,
    '--piwin-artifact-risk': artifact?.risk ?? deck.coral,
    '--piwin-artifact-info': artifact?.info ?? deck.sky,
    '--piwin-artifact-accent-2': artifact?.accent2 ?? deck.ember,
    // Neutral first (see theme-tokens.ts); status hues last.
    '--piwin-artifact-series-1': artifact?.info ?? deck.sky,
    '--piwin-artifact-series-2': deck.iris,
    '--piwin-artifact-series-3': artifact?.accent2 ?? deck.ember,
    '--piwin-artifact-series-4': deck.text2,
    '--piwin-artifact-series-5': artifact?.ok ?? deck.mint,
    '--piwin-artifact-series-6': artifact?.risk ?? deck.coral,
    '--piwin-artifact-shadow-1': dark
      ? `0 1px 0 color-mix(in srgb, ${text} 4%, transparent) inset, 0 1px 2px rgba(0, 0, 0, 0.35)`
      : `0 1px 2px color-mix(in srgb, ${text} 6%, transparent)`,
    '--piwin-artifact-shadow-2': dark
      ? `0 1px 0 color-mix(in srgb, ${text} 5%, transparent) inset, 0 8px 24px rgba(0, 0, 0, 0.45)`
      : `0 1px 2px color-mix(in srgb, ${text} 5%, transparent), 0 8px 24px color-mix(in srgb, ${text} 8%, transparent)`,
    '--piwin-artifact-radius-sm': '6px',
    '--piwin-artifact-radius-lg': '14px',
    '--piwin-artifact-font-mono': FONT_MONO,
  };
}
