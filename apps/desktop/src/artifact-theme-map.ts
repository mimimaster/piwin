import type { ArtifactThemeVariables } from '@piwin/artifact';
import { createDefaultArtifactTheme } from '@piwin/artifact';
import type { ThemeManifest } from '@piwin/contracts';

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

  return {
    '--piwin-artifact-theme': theme.mode,
    '--piwin-artifact-bg': artifact?.bg ?? 'transparent',
    '--piwin-artifact-surface': artifact?.surface ?? tokens.panel,
    '--piwin-artifact-text': artifact?.text ?? tokens.text,
    '--piwin-artifact-muted': artifact?.muted ?? tokens.muted,
    '--piwin-artifact-accent': artifact?.accent ?? tokens.accent,
    '--piwin-artifact-border': artifact?.border ?? tokens.border,
    '--piwin-artifact-radius': artifact?.radius ?? tokens.radius,
    '--piwin-artifact-font': artifact?.font ?? tokens.font,
  };
}
