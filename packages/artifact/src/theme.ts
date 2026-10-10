import { parseColorToken, relativeLuminance } from './color-luminance.js';
import type { ArtifactThemeVariables } from './types.js';

const ON_ACCENT_LIGHT_INK = '#ffffff';
const ON_ACCENT_DARK_INK = '#111827';
/**
 * White stays readable (3:1 or better) on fills up to this luminance, and is
 * what a saturated brand fill is expected to carry. Paler accents, typical of
 * dark themes, need dark ink instead.
 */
const ON_ACCENT_LIGHT_INK_MAX_LUMINANCE = 0.3;

/**
 * Ink for text sitting on a solid `accent` fill (a selected chip, a primary
 * button). No other theme variable is safe there: `bg` is transparent and
 * `surface` is often a faint tint, so borrowing either erases the label.
 * A theme may set `--piwin-artifact-on-accent` itself; otherwise it is derived.
 */
export function resolveArtifactOnAccent(theme: ArtifactThemeVariables): string {
  const authored = theme['--piwin-artifact-on-accent'];
  if (authored !== undefined && authored.trim() !== '') return authored;
  const accent = parseColorToken(theme['--piwin-artifact-accent']);
  if (accent === undefined) return ON_ACCENT_LIGHT_INK;
  return relativeLuminance(accent) <= ON_ACCENT_LIGHT_INK_MAX_LUMINANCE
    ? ON_ACCENT_LIGHT_INK
    : ON_ACCENT_DARK_INK;
}

/** Default dark theme aligned with piwin desktop chrome. */
export function createDefaultArtifactTheme(
  mode: 'light' | 'dark' = 'dark',
): ArtifactThemeVariables {
  if (mode === 'light') {
    return {
      '--piwin-artifact-theme': 'light',
      '--piwin-artifact-bg': 'transparent',
      '--piwin-artifact-surface': 'rgba(0, 0, 0, 0.03)',
      '--piwin-artifact-text': '#111827',
      '--piwin-artifact-muted': '#6b7280',
      '--piwin-artifact-accent': '#2563eb',
      '--piwin-artifact-border': 'rgba(17, 24, 39, 0.12)',
      '--piwin-artifact-radius': '0.75rem',
      '--piwin-artifact-font': 'ui-sans-serif, system-ui, sans-serif',
    };
  }
  return {
    '--piwin-artifact-theme': 'dark',
    '--piwin-artifact-bg': 'transparent',
    '--piwin-artifact-surface': 'rgba(255, 255, 255, 0.05)',
    '--piwin-artifact-text': '#f3f4f6',
    '--piwin-artifact-muted': '#9aa6bd',
    '--piwin-artifact-accent': '#6ea8fe',
    '--piwin-artifact-border': 'rgba(255, 255, 255, 0.12)',
    '--piwin-artifact-radius': '0.75rem',
    '--piwin-artifact-font': 'ui-sans-serif, system-ui, sans-serif',
  };
}
