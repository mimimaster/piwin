import { describe, expect, it } from 'vitest';
import { resolveArtifactPalette, usesArtifactReportKit } from './artifact-style.js';
import { applyArtifactThemeContract } from './theme-contract.js';
import { buildHtmlArtifactSrcdoc } from './srcdoc.js';
import { parseArtifactContrastMessage } from './bridge-protocol.js';
import { analyzeArtifactFence } from './render-intent.js';
import { createArtifactFenceRecord } from './fence-index.js';
import { materializeArtifact } from './materialize.js';

const COVER_SVG = '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice"><rect width="100" height="100" fill="#123"/></svg>';
const CARD = '<style>body{color:#eee}.card{background:#fff;color:#111}</style><div class="card">Hi</div>';

describe('style modes', () => {
  it('resolves fence style, the internal switch, the report kit and legacy scenes', () => {
    const base = { presentation: 'inline' as const, source: '<p>x</p>' };
    expect(resolveArtifactPalette({ ...base, descriptor: { style: 'expressive' } })).toBe('stage');
    expect(resolveArtifactPalette({ ...base, descriptor: { style: 'host' } })).toBe('host');
    expect(resolveArtifactPalette({ ...base, descriptor: {} })).toBe('host');
    expect(
      resolveArtifactPalette({ ...base, descriptor: { style: 'expressive' }, styleModes: 'host-only' }),
    ).toBe('host');
    expect(
      resolveArtifactPalette({ ...base, descriptor: { style: 'expressive' }, forceHost: true }),
    ).toBe('host');
    expect(
      resolveArtifactPalette({
        presentation: 'inline',
        source: '<main class="piwin-report">r</main>',
        descriptor: { style: 'expressive' },
      }),
    ).toBe('host');
    // Legacy fences keep the cover-scene heuristic; a v14 fence style wins over it.
    expect(resolveArtifactPalette({ presentation: 'canvas', source: COVER_SVG, descriptor: {} })).toBe('own');
    expect(
      resolveArtifactPalette({ presentation: 'canvas', source: COVER_SVG, descriptor: { style: 'host' } }),
    ).toBe('host');
    expect(usesArtifactReportKit('<p class="piwin-report-ish">')).toBe(false);
  });

  it('stage repair keeps cards but still fixes the page shell and invented names', () => {
    const host = applyArtifactThemeContract(CARD, { palette: 'host' });
    expect(host.source).not.toContain('background:#fff');
    const stage = applyArtifactThemeContract(
      `${CARD}<p style="color:var(--piwin-artifact-headline)">t</p>`,
      { palette: 'stage' },
    );
    expect(stage.source).toContain('.card{background:#fff;color:#111}');
    expect(stage.source).toContain('var(--piwin-artifact-text)');
    expect(stage.source).not.toContain('--piwin-artifact-headline');
  });

  it('marks the root and guards only the shell for expressive documents', () => {
    const stage = buildHtmlArtifactSrcdoc({ source: '<p>x</p>', channelId: 'c', palette: 'stage', freezeSource: true }).srcdoc;
    expect(stage).toContain('data-piwin-style="expressive"');
    expect(stage).toContain('<style data-piwin-artifact-theme-guard>');
    expect(stage).not.toContain('.bg-white');
    expect(stage).toContain('piwin-artifact:contrast');
    const host = buildHtmlArtifactSrcdoc({ source: '<p>x</p>', channelId: 'c', freezeSource: true }).srcdoc;
    expect(host).toContain('data-piwin-style="host"');
    expect(host).toContain('.bg-white');
    expect(host).not.toContain('piwin-artifact:contrast');
    const own = buildHtmlArtifactSrcdoc({ source: '<p>x</p>', channelId: 'c', palette: 'own' }).srcdoc;
    expect(own).not.toContain('<style data-piwin-artifact-theme-guard>');
  });

  it('skips the probe while streaming', () => {
    const stream = buildHtmlArtifactSrcdoc({
      source: '<p>x</p>',
      channelId: 'c',
      palette: 'stage',
      freezeSource: false,
    }).srcdoc;
    expect(stream).not.toContain('piwin-artifact:contrast');
    const final = buildHtmlArtifactSrcdoc({
      source: '<p>x</p>',
      channelId: 'c',
      palette: 'stage',
      freezeSource: true,
    }).srcdoc;
    expect(final).toContain('piwin-artifact:contrast');
  });

  it('sandboxes an expressive fragment that would otherwise be static', () => {
    const record = createArtifactFenceRecord({ info: 'artifact-html title="T" style="expressive"', source: '<p>x</p>' });
    const analysis = analyzeArtifactFence(record, { id: 'a', htmlUiModeEnabled: true });
    if (analysis.kind !== 'intent') throw new Error('expected intent');
    const plan = materializeArtifact(analysis.intent, { mode: 'interactive', presentation: 'inline' });
    expect(plan.document.kind).toBe('sandbox');
    const hostView = materializeArtifact(analysis.intent, {
      mode: 'interactive',
      presentation: 'inline',
      forceHostStyle: true,
    });
    expect(hostView.document.kind).toBe('static-source');
  });

  it('parses only well-formed, meaningful contrast reports', () => {
    expect(
      parseArtifactContrastMessage({
        type: 'piwin-artifact:contrast',
        channelId: 'c',
        lowContrast: true,
        themeMismatch: false,
        sampled: 12.4,
        failing: 1e9,
        minRatio: 0.2,
      }),
    ).toEqual({
      type: 'piwin-artifact:contrast',
      channelId: 'c',
      lowContrast: true,
      themeMismatch: false,
      sampled: 12,
      failing: 10_000,
      minRatio: 1,
    });
    expect(
      parseArtifactContrastMessage({ type: 'piwin-artifact:contrast', channelId: 'c', lowContrast: false }),
    ).toBeNull();
    expect(parseArtifactContrastMessage({ type: 'piwin-artifact:contrast', lowContrast: true })).toBeNull();
  });
});
