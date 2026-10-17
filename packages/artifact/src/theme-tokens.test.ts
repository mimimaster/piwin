import { describe, expect, it } from 'vitest';
import { createDefaultArtifactTheme } from './theme.js';
import { ARTIFACT_V14_TOKEN_NAMES } from './theme-tokens.js';
import { buildArtifactThemeCss, resolveArtifactThemeCssVariables } from './srcdoc-css.js';
import { buildArtifactReportKitCss } from './srcdoc-report-kit.js';

describe('v14 artifact vocabulary', () => {
  it('fills every v14 token for a caller that only supplies the base seven', () => {
    const vars = new Map(resolveArtifactThemeCssVariables(createDefaultArtifactTheme('light')));
    for (const name of ARTIFACT_V14_TOKEN_NAMES) {
      expect(vars.get(`--piwin-artifact-${name}`), name).toBeTruthy();
    }
  });

  it('starts chart series on a neutral hue and keeps status hues last', () => {
    const vars = new Map(resolveArtifactThemeCssVariables(createDefaultArtifactTheme('dark')));
    expect(vars.get('--piwin-artifact-series-1')).toBe('var(--piwin-artifact-info)');
    expect(vars.get('--piwin-artifact-series-5')).toBe('var(--piwin-artifact-ok)');
    expect(vars.get('--piwin-artifact-series-6')).toBe('var(--piwin-artifact-risk)');
  });

  it('prefers authored values over derived fallbacks', () => {
    const theme = { ...createDefaultArtifactTheme('dark'), '--piwin-artifact-ok': '#00ff88' };
    expect(new Map(resolveArtifactThemeCssVariables(theme)).get('--piwin-artifact-ok')).toBe('#00ff88');
  });

  it('never emits the host-only on-accent input as a CSS variable', () => {
    const theme = { ...createDefaultArtifactTheme('dark'), '--piwin-artifact-on-accent-themed': '#111' };
    const css = buildArtifactThemeCss(theme, { rules: 'v14' });
    expect(css).not.toContain('on-accent-themed');
    expect(css).toContain('--piwin-artifact-on-accent: #111');
  });
});

describe('report kit by rules', () => {
  it('maps tones to host status tokens only for v14 fences', () => {
    const v14 = buildArtifactReportKitCss({ rules: 'v14' });
    const legacy = buildArtifactReportKitCss();
    expect(v14).toContain('--piwin-kit-ok: var(--piwin-artifact-ok)');
    // v14 stats are a flat metric strip; only a toned figure colors its rule.
    expect(v14).toContain('border-left-color: var(--piwin-kit-tone)');
    expect(v14).not.toContain('shadow-1');
    expect(legacy).not.toContain('var(--piwin-artifact-ok)');
    expect(legacy).not.toContain('shadow-1');
    expect(legacy).toContain('[data-tone="info"]');
  });
});
