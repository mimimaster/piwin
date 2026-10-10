import { describe, expect, it } from 'vitest';
import { buildArtifactThemeCss } from './srcdoc-css.js';
import { createDefaultArtifactTheme, resolveArtifactOnAccent } from './theme.js';

describe('resolveArtifactOnAccent', () => {
  const light = createDefaultArtifactTheme('light');

  it('puts white ink on a saturated accent', () => {
    expect(resolveArtifactOnAccent(light)).toBe('#ffffff');
    expect(resolveArtifactOnAccent({ ...light, '--piwin-artifact-accent': '#c6412a' })).toBe(
      '#ffffff',
    );
  });

  it('puts dark ink on a pale accent', () => {
    expect(resolveArtifactOnAccent(createDefaultArtifactTheme('dark'))).toBe('#111827');
  });

  it('keeps an ink the theme authored', () => {
    expect(resolveArtifactOnAccent({ ...light, '--piwin-artifact-on-accent': '#fef3c7' })).toBe(
      '#fef3c7',
    );
  });

  it('falls back to white when the accent is not a color it can measure', () => {
    expect(
      resolveArtifactOnAccent({ ...light, '--piwin-artifact-accent': 'oklch(0.6 0.2 30)' }),
    ).toBe('#ffffff');
  });

  it('is always defined in the sandbox document', () => {
    expect(buildArtifactThemeCss(light)).toContain('--piwin-artifact-on-accent: #ffffff;');
  });
});
