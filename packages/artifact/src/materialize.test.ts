import { describe, expect, it } from 'vitest';
import { createArtifactFenceRecord } from './fence-index.js';
import { materializeArtifact } from './materialize.js';
import { analyzeArtifactFence } from './render-intent.js';

function analyze(info: string, source: string, extras: Parameters<typeof analyzeArtifactFence>[1] = {}) {
  return analyzeArtifactFence(createArtifactFenceRecord({ info, source }), extras);
}

describe('materializeArtifact', () => {
  it('emits static source for a completed inert fragment', () => {
    const analysis = analyze('artifact-html', '<section><h1>Hello</h1></section>', { id: 'demo' });
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    const plan = materializeArtifact(analysis.intent, { mode: 'interactive' });
    expect(plan.kind).toBe('render');
    expect(plan.mode).toBe('interactive');
    expect(plan.intent.renderer).toBe('static');
    expect(plan.document).toEqual({
      kind: 'static-source',
      source: expect.stringContaining('<h1>Hello</h1>'),
    });
    expect(plan.renderSource).toContain('<h1>Hello</h1>');
    expect(plan.frameMode).toBe('inline-flow');
  });

  it('builds surface-specific overflow policy for an explicit Canvas fence', () => {
    const analysis = analyze(
      'artifact-html title="Workspace" surface="canvas"',
      '<main>Wide workspace</main>',
      { id: 'canvas-workspace' },
    );
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    const plan = materializeArtifact(analysis.intent, { mode: 'interactive' });
    expect(plan.intent.surface).toBe('canvas');
    expect(plan.frameMode).toBe('canvas');
    expect(plan.document.kind).toBe('sandbox');
    if (plan.document.kind === 'sandbox') {
      expect(plan.document.srcdoc).toContain('overflow-x: auto !important');
      expect(plan.document.srcdoc).toContain('overflow-y: auto !important');
    }
  });

  it('soft-repairs hard-coded light surfaces without rewriting descriptor source', () => {
    const analysis = analyze('artifact-html', '<div style="background: white">Card</div>', {
      id: 'light',
    });
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    const plan = materializeArtifact(analysis.intent, { mode: 'interactive' });
    expect(plan.renderSource).toContain('var(--piwin-artifact-surface)');
    expect(analysis.intent.descriptor.source).toContain('background: white');
  });

  it('returns stream-preview sandbox and strips scripts', () => {
    const analysis = analyze('html', '<div class="card"><p>Hi</p></div><script>alert(1)', {
      id: 'stream',
      mode: 'stream-preview',
      htmlUiModeEnabled: true,
    });
    expect(['intent', 'code']).toContain(analysis.kind);
    if (analysis.kind !== 'intent') return;
    const plan = materializeArtifact(analysis.intent, { mode: 'stream-preview' });
    expect(plan.mode).toBe('stream-preview');
    expect(plan.intent.renderer).toBe('sandbox');
    expect(plan.document.kind).toBe('sandbox');
    expect(plan.renderSource).toBe('<div class="card"><p>Hi</p></div>');
    expect(plan.renderSource).not.toContain('<script');
    if (plan.document.kind === 'sandbox') {
      expect(plan.document.srcdoc).toContain('<div class="card"><p>Hi</p></div>');
      expect(plan.document.srcdoc).not.toContain('alert(1)');
      expect(plan.document.srcdoc).toContain('piwin-artifact:size');
      expect(plan.document.srcdoc).toContain('piwin-artifact:stream-update');
      expect(plan.document.srcdoc).toContain('name="piwin-artifact-channel" content="stream"');
      expect(plan.document.srcdoc).not.toContain('content="stream-stream"');
    }
  });

  it('mounts a sandbox frame immediately for not-yet-streamable sources', () => {
    const empty = analyze('artifact-html', '', { id: 'empty-stream', mode: 'stream-preview' });
    expect(empty.kind).toBe('intent');
    if (empty.kind !== 'intent') return;
    const emptyPlan = materializeArtifact(empty.intent, { mode: 'stream-preview' });
    expect(emptyPlan.document.kind).toBe('sandbox');
    if (emptyPlan.document.kind === 'sandbox') {
      expect(emptyPlan.document.srcdoc).toContain('piwin-artifact:size');
    }

    const styleOnly = analyze('artifact-html', '<style>.card { color: red; }</style>', {
      id: 'style-only-stream',
      mode: 'stream-preview',
    });
    expect(styleOnly.kind).toBe('intent');
  });

  it('renders an incomplete SVG as a safe stream snapshot', () => {
    const analysis = analyze('svg', '<svg viewBox="0 0 80 20"><text x="2" y="14">Lo', {
      id: 'svg-stream',
      mode: 'stream-preview',
      htmlUiModeEnabled: true,
    });
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    const plan = materializeArtifact(analysis.intent, { mode: 'stream-preview' });
    expect(plan.renderSource).toContain('Lo</text></svg>');
  });

  it('returns blocked for external script without materializing', () => {
    const analysis = analyze(
      'artifact-html',
      '<script src="https://cdn.example.com/x.js"></script>',
      { id: 'bad' },
    );
    expect(analysis.kind).toBe('blocked');
    if (analysis.kind === 'blocked') {
      expect(analysis.reason).toBe('blocked-external-resource');
    }
  });

  it('returns code for non-artifact languages', () => {
    const analysis = analyze('ts', 'export const x = 1');
    expect(analysis.kind).toBe('code');
  });

  it('renders a safe svg fence as static source', () => {
    const analysis = analyze(
      'svg',
      '<svg viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" /></svg>',
      { id: 'svg-render', htmlUiModeEnabled: true },
    );
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    expect(analysis.intent.descriptor.type).toBe('svg');
    const plan = materializeArtifact(analysis.intent, { mode: 'interactive' });
    expect(plan.document.kind).toBe('static-source');
    expect(plan.renderSource).toContain('<svg viewBox="0 0 100 60">');
  });
});
