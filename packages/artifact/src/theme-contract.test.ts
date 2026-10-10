import { describe, expect, it } from 'vitest';
import { applyArtifactThemeContract } from './theme-contract.js';

describe('applyArtifactThemeContract', () => {
  it('rewrites hard-coded white backgrounds', () => {
    const result = applyArtifactThemeContract(
      '<div style="background: white; color: #111">Card</div>',
    );
    expect(result.changed).toBe(true);
    expect(result.source).toContain('var(--piwin-artifact-surface)');
    expect(result.source).not.toMatch(/background:\s*white/i);
    expect(result.repairs.length).toBeGreaterThan(0);
  });

  it('keeps out-of-flow light circles such as snow particles', () => {
    const source =
      '<style>#snow i { position:absolute; top:-24px; border-radius:50%; background:#fff; animation:fall linear infinite; }</style><i style="position:absolute; border-radius:50%; background:#fff"></i>';
    expect(applyArtifactThemeContract(source).changed).toBe(false);
  });

  it('still rewrites an in-flow light circle that can hold text', () => {
    const result = applyArtifactThemeContract(
      '<style>.badge { border-radius:50%; background:#fff; }</style>',
    );
    expect(result.source).toContain('background: var(--piwin-artifact-surface)');
  });

  it('keeps see-through light glows and still rewrites frosted light cards', () => {
    const glow =
      '<style>.glow { background: radial-gradient(circle, rgba(255,255,255,.4), transparent 70%); }\n.shine { background: rgba(255, 255, 255, 0.12); }</style>';
    expect(applyArtifactThemeContract(glow).changed).toBe(false);
    const frosted = applyArtifactThemeContract(
      '<style>.card { background: rgba(255, 255, 255, 0.8); }</style>',
    );
    expect(frosted.source).toContain('background: var(--piwin-artifact-surface)');
  });

  it('rewrites bg-white class', () => {
    const result = applyArtifactThemeContract('<div class="card bg-white p-4">x</div>');
    expect(result.changed).toBe(true);
    expect(result.source).toContain('piwin-artifact-surface');
    expect(result.source).not.toContain('bg-white');
  });

  it('maps invented --piwin-artifact-* names to host variables', () => {
    const result = applyArtifactThemeContract(
      '<style>:root { --card: var(--piwin-artifact-surface-elevated, #273549); --t: var(--piwin-artifact-text-secondary); }</style>',
    );
    expect(result.source).toContain('var(--piwin-artifact-surface, #273549)');
    expect(result.source).toContain('var(--piwin-artifact-muted)');
    expect(result.issues.map((issue) => issue.kind)).toEqual([
      'unknown-theme-variable',
      'unknown-theme-variable',
    ]);
  });

  it('keeps host-defined theme variables untouched', () => {
    const source =
      '<style>.a { color: var(--piwin-artifact-text); font-size: var(--piwin-artifact-font-size); }</style>';
    expect(applyArtifactThemeContract(source).changed).toBe(false);
  });

  it('rewrites fixed light text that has no dark background of its own', () => {
    const result = applyArtifactThemeContract(
      '<style>h1.title { font-size: 26px; color: #fff; }\n.tab.active { color: #ffffff; background: var(--bg-surface); }</style><h4 style="font-size: 14px; color: #fff;">x</h4>',
    );
    expect(result.source).not.toMatch(/color:\s*#fff/i);
    expect(result.source.match(/color: var\(--piwin-artifact-text\)/g)).toHaveLength(3);
    expect(result.source).toContain('font-size: 26px');
  });

  it('keeps light text on a fixed filled button', () => {
    const source = '<style>.chip { background: #2563eb; color: white; }</style>';
    expect(applyArtifactThemeContract(source).changed).toBe(false);
  });

  it('swaps a fixed ink on an accent fill for the theme ink, since accent may be pale', () => {
    const result = applyArtifactThemeContract(
      '<style>.btn { background: var(--piwin-artifact-accent); color: #fff; }\n.cta { background: var(--piwin-artifact-accent, #2563eb); color: #ffffff; }</style>',
    );
    expect(result.source.match(/color: var\(--piwin-artifact-on-accent\)/g)).toHaveLength(2);
    expect(result.source).toContain('background: var(--piwin-artifact-accent, #2563eb)');
  });

  it('gives a solid accent fill a readable ink instead of a transparent variable', () => {
    const result = applyArtifactThemeContract(
      '<style>.chip[aria-pressed="true"] { background:var(--piwin-artifact-accent); color:var(--piwin-artifact-bg); border-color:var(--piwin-artifact-accent); }\n.btn { background: var(--piwin-artifact-accent); color: var(--piwin-artifact-surface); }</style><b style="background: var(--piwin-artifact-accent); color: var(--piwin-artifact-accent)">x</b>',
    );
    expect(result.source.match(/color:\s*var\(--piwin-artifact-on-accent\)/g)).toHaveLength(3);
    expect(result.source).toContain('border-color:var(--piwin-artifact-accent)');
    expect(result.issues.every((issue) => issue.kind === 'unreadable-fill-text')).toBe(true);
  });

  it('repairs the ink of a solid fill even when the artifact owns its palette', () => {
    const result = applyArtifactThemeContract(
      '<style>.on { background: var(--piwin-artifact-text); color: var(--piwin-artifact-bg); }</style>',
      { palette: 'own' },
    );
    expect(result.source).toContain('color: Canvas');
  });

  it('maps an invented on-accent name to the on-accent ink, not to accent', () => {
    const result = applyArtifactThemeContract(
      '<style>.a { color: var(--piwin-artifact-accent-contrast); }\n.b { color: var(--piwin-artifact-accent-fg, #fff); }\n.c { background: var(--piwin-artifact-accent-soft); }</style>',
    );
    expect(result.source.match(/var\(--piwin-artifact-on-accent/g)).toHaveLength(2);
    expect(result.source).toContain('background: var(--piwin-artifact-accent)');
  });

  it('leaves readable theme pairings alone', () => {
    const source =
      '<style>.a { background: var(--piwin-artifact-accent); color: var(--piwin-artifact-on-accent); }\n.b { background: color-mix(in srgb, var(--piwin-artifact-accent) 12%, transparent); color: var(--piwin-artifact-accent); }\n.c { background: var(--piwin-artifact-surface); color: var(--piwin-artifact-muted); }\n.d { background: var(--piwin-artifact-text); color: var(--piwin-artifact-accent); }</style>';
    expect(applyArtifactThemeContract(source).changed).toBe(false);
  });

  it('rewrites light text on an accent tint, which is a wash rather than a fill', () => {
    const result = applyArtifactThemeContract(
      '<style>.tag { background: color-mix(in srgb, var(--piwin-artifact-accent) 12%, transparent); color: #fff; }</style>',
    );
    expect(result.source).toContain('color: var(--piwin-artifact-text)');
  });

  it('rewrites fixed dark surfaces that rely on theme text', () => {
    const result = applyArtifactThemeContract(
      '<style>.card { background: #1e293b; border: 1px solid #334155; padding: 16px; }</style>',
    );
    expect(result.source).toContain('background: var(--piwin-artifact-surface)');
    expect(result.source).toContain('border: 1px solid #334155');
    expect(result.issues[0]?.kind).toBe('fixed-dark-surface');
  });

  it('keeps see-through dark overlays so they do not cover the artwork', () => {
    const source = `<style>
.vignette { position:absolute; inset:0; z-index:3; background:radial-gradient(ellipse at center, transparent 52%, rgba(8,10,24,.55) 100%); }
.scrim { background: rgba(0, 0, 0, 0.6); }
</style>`;
    expect(applyArtifactThemeContract(source).changed).toBe(false);
  });

  it('still rewrites a nearly opaque dark surface', () => {
    const result = applyArtifactThemeContract(
      '<style>.card { background: rgba(15, 17, 23, 0.96); }</style>',
    );
    expect(result.source).toContain('background: var(--piwin-artifact-surface)');
  });

  it('keeps a self-consistent dark code block', () => {
    const source = '<style>pre { background: #090d16; color: #e2e8f0; }</style>';
    expect(applyArtifactThemeContract(source).changed).toBe(false);
  });

  it('ignores braces outside style elements', () => {
    const source = '<script>const o = { background: "#000" };</script>';
    expect(applyArtifactThemeContract(source).changed).toBe(false);
  });

  it('rewrites a dark canvas page that pairs dark surfaces with light text', () => {
    const result = applyArtifactThemeContract(`<style>
html, body { margin: 0; background: #0f1117; color: #e5e7eb; height: 100%; }
.wrap { min-height: 100%; background: #0f1117; }
.card { background: #16181d; color: #fff; }
pre { background: #090d16; color: #e2e8f0; }
</style><div class="wrap"><div class="card">x</div><pre>code</pre></div>`);
    expect(result.changed).toBe(true);
    expect(result.source).toContain('html, body { margin: 0; background: var(--piwin-artifact-surface); color: var(--piwin-artifact-text); height: 100%; }');
    expect(result.source).toContain('.wrap { min-height: 100%; background: var(--piwin-artifact-surface); }');
    expect(result.source).toContain('.card { background: var(--piwin-artifact-surface); color: var(--piwin-artifact-text); }');
    expect(result.source).toContain('pre { background: #090d16; color: #e2e8f0; }');
    expect(result.issues.some((issue) => issue.kind === 'fixed-dark-surface')).toBe(true);
  });

  it('rewrites inline dark page fills and keeps dark code tags', () => {
    const result = applyArtifactThemeContract(
      '<div style="background: #111827; color: #fff; min-height: 100%">Dark</div><pre style="background: #090d16; color: #e2e8f0">code</pre>',
    );
    expect(result.changed).toBe(true);
    expect(result.source).toContain(
      '<div style="background: var(--piwin-artifact-surface); color: var(--piwin-artifact-text); min-height: 100%">Dark</div>',
    );
    expect(result.source).toContain('<pre style="background: #090d16; color: #e2e8f0">code</pre>');
  });
});
