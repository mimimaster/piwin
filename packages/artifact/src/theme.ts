import type { ArtifactThemeVariables } from './types.js';

/** Default dark theme aligned with piwin desktop chrome. */
export function createDefaultArtifactTheme(
  mode: 'light' | 'dark' = 'dark',
): ArtifactThemeVariables {
  if (mode === 'light') {
    return {
      '--piwin-artifact-theme': 'light',
      '--piwin-artifact-bg': 'transparent',
      '--piwin-artifact-surface': 'rgba(255, 255, 255, 0.92)',
      '--piwin-artifact-text': '#111827',
      '--piwin-artifact-muted': '#6b7280',
      '--piwin-artifact-accent': '#2563eb',
      '--piwin-artifact-border': 'rgba(17, 24, 39, 0.14)',
      '--piwin-artifact-radius': '0.75rem',
      '--piwin-artifact-font': 'ui-sans-serif, system-ui, sans-serif',
    };
  }
  return {
    '--piwin-artifact-theme': 'dark',
    '--piwin-artifact-bg': 'transparent',
    '--piwin-artifact-surface': 'rgba(30, 35, 48, 0.92)',
    '--piwin-artifact-text': '#e8ecf5',
    '--piwin-artifact-muted': '#9aa6bd',
    '--piwin-artifact-accent': '#6ea8fe',
    '--piwin-artifact-border': 'rgba(42, 49, 66, 0.9)',
    '--piwin-artifact-radius': '0.75rem',
    '--piwin-artifact-font': 'ui-sans-serif, system-ui, sans-serif',
  };
}
