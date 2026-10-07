import { describe, expect, it } from 'vitest';
import { analyzeArtifactFence } from './render-intent.js';
import { createArtifactFenceRecord } from './fence-index.js';
import { materializeArtifact } from './materialize.js';
import { paintsOwnScene } from './scene-palette.js';

const SCENE = `<!DOCTYPE html><html><head><style>
html,body { height:100%; background:#0e1428; }
.cap { position:absolute; color:#f5e6b8; }
.vignette { position:absolute; inset:0; background:rgba(8,10,24,.95); }
</style></head><body>
<svg class="scene" viewBox="0 0 1200 600" preserveAspectRatio="xMidYMid slice"><rect width="1200" height="600" fill="#10162c"/></svg>
<div class="cap">Title</div><script>void 0;</script></body></html>`;

function sceneIntent(surface: 'canvas' | 'inline') {
  const info =
    surface === 'canvas' ? 'artifact-html title="Scene" surface="canvas"' : 'artifact-html title="Scene"';
  const analysis = analyzeArtifactFence(createArtifactFenceRecord({ info, source: SCENE }));
  if (analysis.kind !== 'intent') throw new Error('expected a renderable intent');
  return analysis.intent;
}

describe('paintsOwnScene', () => {
  it('recognizes a cover-fill SVG stage', () => {
    expect(paintsOwnScene(SCENE)).toBe(true);
    expect(paintsOwnScene("<svg viewBox='0 0 4 3' preserveAspectRatio='xMinYMin slice'></svg>")).toBe(true);
  });

  it('ignores contained SVGs, icons, and slice without a design box', () => {
    expect(paintsOwnScene('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>')).toBe(false);
    expect(paintsOwnScene('<svg viewBox="0 0 4 3" preserveAspectRatio="xMidYMid meet"></svg>')).toBe(false);
    expect(paintsOwnScene('<svg preserveAspectRatio="xMidYMid slice"></svg>')).toBe(false);
    expect(paintsOwnScene('<p>preserveAspectRatio="xMidYMid slice"</p>')).toBe(false);
  });
});

describe('materializeArtifact scene palette', () => {
  it('keeps a Canvas scene in its own colors and drops the theme guard', () => {
    const plan = materializeArtifact(sceneIntent('canvas'), { mode: 'interactive' });
    expect(plan.renderSource).toContain('background:#0e1428');
    expect(plan.renderSource).toContain('color:#f5e6b8');
    expect(plan.renderSource).toContain('background:rgba(8,10,24,.95)');
    if (plan.document.kind !== 'sandbox') throw new Error('expected a sandbox document');
    expect(plan.document.srcdoc).not.toContain('data-piwin-artifact-theme-guard');
  });

  it('still repairs the same scene when it is shown Inline', () => {
    const plan = materializeArtifact(sceneIntent('inline'), { mode: 'interactive' });
    expect(plan.renderSource).toContain('var(--piwin-artifact-surface)');
    if (plan.document.kind !== 'sandbox') throw new Error('expected a sandbox document');
    expect(plan.document.srcdoc).toContain('data-piwin-artifact-theme-guard');
  });

  it('still repairs a Canvas document that is not a scene', () => {
    const analysis = analyzeArtifactFence(
      createArtifactFenceRecord({
        info: 'artifact-html title="Report" surface="canvas"',
        source: '<style>body { background:#0f1117; color:#e5e7eb; }</style><h1>Report</h1>',
      }),
    );
    if (analysis.kind !== 'intent') throw new Error('expected a renderable intent');
    const plan = materializeArtifact(analysis.intent, { mode: 'interactive' });
    expect(plan.renderSource).toContain('background:var(--piwin-artifact-surface)');
  });
});
