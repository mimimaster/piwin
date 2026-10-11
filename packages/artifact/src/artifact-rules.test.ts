import { describe, expect, it } from 'vitest';
import { resolveArtifactRules } from './artifact-rules.js';
import { createArtifactFenceRecord } from './fence-index.js';
import { parseFenceStyle } from './fence-syntax.js';
import { parseArtifactFenceRecord } from './parser.js';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';
import { buildArtifactThemeCss, resolveArtifactOnAccentForRules } from './srcdoc-css.js';
import { createDefaultArtifactTheme } from './theme.js';
import type { ArtifactThemeVariables } from './types.js';

function parse(info: string, source = '<section class="x">hi</section>') {
  return parseArtifactFenceRecord(createArtifactFenceRecord({ info, source }), { id: 'a1' });
}

const inkTheme: ArtifactThemeVariables = {
  ...createDefaultArtifactTheme('dark'),
  '--piwin-artifact-accent': '#e25a3d',
  '--piwin-artifact-on-accent-themed': '#1c0b07',
};

describe('fence style declaration', () => {
  it('reads host and expressive, case-insensitively', () => {
    expect(parseFenceStyle('artifact-html title="A" style="host"')).toBe('host');
    expect(parseFenceStyle('artifact-html style="Expressive" surface="canvas"')).toBe('expressive');
  });

  it('ignores a missing or unknown style', () => {
    expect(parseFenceStyle('artifact-html title="A"')).toBeUndefined();
    expect(parseFenceStyle('artifact-html style="neon"')).toBeUndefined();
  });

  it('records the declared style on the descriptor only when present', () => {
    expect(parse('artifact-html title="A" style="expressive"')?.style).toBe('expressive');
    expect(parse('html title="A" style="host"')?.style).toBe('host');
    expect(parse('artifact-html title="A"')).not.toHaveProperty('style');
  });
});

describe('resolveArtifactRules', () => {
  it('treats a declared style as the v14 marker', () => {
    expect(resolveArtifactRules({ style: 'host' })).toBe('v14');
    expect(resolveArtifactRules({ style: 'expressive' })).toBe('v14');
    expect(resolveArtifactRules({})).toBe('legacy');
  });
});

describe('on-accent per rules', () => {
  it('keeps the derived ink for legacy artifacts', () => {
    expect(resolveArtifactOnAccentForRules(inkTheme, 'legacy')).toBe('#ffffff');
    expect(resolveArtifactOnAccentForRules(inkTheme)).toBe('#ffffff');
  });

  it('uses the theme-authored ink for v14 artifacts', () => {
    expect(resolveArtifactOnAccentForRules(inkTheme, 'v14')).toBe('#1c0b07');
  });

  it('falls back to the derived ink when the theme has none', () => {
    expect(resolveArtifactOnAccentForRules(createDefaultArtifactTheme('light'), 'v14')).toBe(
      '#ffffff',
    );
  });

  it('never emits the host-only input as a CSS variable', () => {
    const css = buildArtifactThemeCss(inkTheme, { rules: 'v14' });
    expect(css).not.toContain('on-accent-themed');
    expect(css).toContain('--piwin-artifact-on-accent: #1c0b07;');
  });

  it('threads rules through the srcdoc builder', () => {
    const legacy = buildHtmlArtifactSrcdoc({ source: '<p>x</p>', channelId: 'c', theme: inkTheme });
    const v14 = buildHtmlArtifactSrcdoc({
      source: '<p>x</p>',
      channelId: 'c',
      theme: inkTheme,
      rules: 'v14',
    });
    expect(legacy.srcdoc).toContain('--piwin-artifact-on-accent: #ffffff;');
    expect(v14.srcdoc).toContain('--piwin-artifact-on-accent: #1c0b07;');
  });
});

describe('inline table wrapping', () => {
  const css = buildArtifactThemeCss(createDefaultArtifactTheme('dark'));
  const tableRules = css.slice(css.indexOf('.piwin-artifact-root table'));

  it('wraps cells at word boundaries, as the runtime contract says', () => {
    expect(tableRules).toMatch(/th,\s*\n?html\[data-frame-mode="inline-flow"\] \.piwin-artifact-root td \{\s*overflow-wrap: break-word;/);
    expect(tableRules).not.toMatch(/td \{\s*overflow-wrap: anywhere/);
  });

  it('sizes columns from content instead of splitting them evenly', () => {
    expect(tableRules).toContain('table-layout: auto;');
    expect(tableRules).not.toContain('table-layout: fixed;');
  });
});
