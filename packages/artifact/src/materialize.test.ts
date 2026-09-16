import { describe, expect, it } from 'vitest';
import { createArtifactFenceRecord } from './fence-index.js';
import { materializeArtifact } from './materialize.js';
import { analyzeArtifactFence } from './render-intent.js';

function analyze(
  info: string,
  source: string,
  extras: Parameters<typeof analyzeArtifactFence>[1] = {},
) {
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
      expect(plan.document.srcdoc).toContain('data-frame-mode="canvas"');
      expect(plan.document.srcdoc).toContain('html[data-frame-mode="canvas"]');
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

  it('binds session media ids in render HTML without rewriting descriptor source', () => {
    const mediaId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const source = `<section><img data-piwin-media="${mediaId}" alt="icon"></section>`;
    const analysis = analyze('artifact-html', source, { id: 'media-bind' });
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    const dataUrl = 'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAA==';
    const plan = materializeArtifact(analysis.intent, {
      mode: 'interactive',
      mediaDataUrls: new Map([[mediaId, dataUrl]]),
    });
    expect(plan.renderSource).toContain(`src="${dataUrl}"`);
    expect(plan.renderSource).toContain(`data-piwin-media="${mediaId}"`);
    expect(analysis.intent.descriptor.source).toContain(`data-piwin-media="${mediaId}"`);
    expect(analysis.intent.descriptor.source).not.toContain(`src="${dataUrl}"`);
  });

  it('drops a blob: media URL the sandbox opaque origin could never read', () => {
    const mediaId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const source = `<section><img data-piwin-media="${mediaId}" alt="icon"></section>`;
    const analysis = analyze('artifact-html', source, { id: 'media-blob' });
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    const plan = materializeArtifact(analysis.intent, {
      mode: 'interactive',
      mediaDataUrls: new Map([[mediaId, 'blob:http://localhost/media-1']]),
    });
    expect(plan.renderSource).not.toContain('blob:');
    expect(plan.renderSource).toContain(`data-piwin-media="${mediaId}"`);
  });

  it('hosts full-document stream-preview in a fragment root so updates can land', () => {
    const source = [
      '<!DOCTYPE html>',
      '<html><head><style>.scene{display:grid}</style></head>',
      '<body><div class="scene"><svg class="bird"><circle cx="8" cy="8" r="6"/></svg></div>',
      '<script>window.boot=1</script></body></html>',
    ].join('');
    const analysis = analyze('artifact-html title="Pelican" surface="canvas"', source, {
      id: 'doc-stream',
      mode: 'stream-preview',
    });
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    expect(analysis.intent.descriptor.documentKind).toBe('document');

    const plan = materializeArtifact(analysis.intent, {
      mode: 'stream-preview',
      source,
      presentation: 'canvas',
    });
    expect(plan.renderSource).toContain('<style>.scene{display:grid}</style>');
    expect(plan.renderSource).toContain('<div class="scene">');
    expect(plan.renderSource).not.toContain('<!DOCTYPE');
    expect(plan.renderSource).not.toContain('<script');
    if (plan.document.kind === 'sandbox') {
      expect(plan.document.srcdoc).toContain('piwin-artifact-root');
      expect(plan.document.srcdoc).toContain('<div class="scene">');
      expect(plan.document.srcdoc).toContain('piwin-artifact:stream-update');
    }
  });

  it('returns stream-preview sandbox and strips scripts', () => {
    const analysis = analyze(
      'html',
      '<style>.card { color: red; }</style><div class="card"><p>Hi</p></div><script>alert(1)',
      {
        id: 'stream',
        mode: 'stream-preview',
        htmlUiModeEnabled: true,
      },
    );
    expect(['intent', 'code']).toContain(analysis.kind);
    if (analysis.kind !== 'intent') return;
    const plan = materializeArtifact(analysis.intent, { mode: 'stream-preview' });
    expect(plan.mode).toBe('stream-preview');
    expect(plan.intent.renderer).toBe('sandbox');
    expect(plan.document.kind).toBe('sandbox');
    expect(plan.renderSource).toBe(
      '<style>.card { color: red; }</style><div class="card"><p>Hi</p></div>',
    );
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

  it('keeps CSS-dependent markup out of the stream document until its style foundation closes', () => {
    const unstyledSource =
      '<div class="scene"><svg class="pelican"><circle cx="10" cy="10" r="8" /></svg></div>';
    const unstyled = analyze('artifact-html', unstyledSource, {
      id: 'css-late-stream',
      mode: 'stream-preview',
    });
    expect(unstyled.kind).toBe('intent');
    if (unstyled.kind !== 'intent') return;

    const unstyledPlan = materializeArtifact(unstyled.intent, {
      mode: 'stream-preview',
    });
    expect(unstyledPlan.renderSource).toBe('');

    const styledSource = `${unstyledSource}<style>.scene { display: grid; }</style>`;
    const styled = analyze('artifact-html', styledSource, {
      id: 'css-late-stream',
      mode: 'stream-preview',
    });
    expect(styled.kind).toBe('intent');
    if (styled.kind !== 'intent') return;

    const styledPlan = materializeArtifact(styled.intent, {
      mode: 'stream-preview',
    });
    expect(styledPlan.renderSource).toContain('<div class="scene">');
    expect(styledPlan.renderSource).toContain('<style>.scene { display: grid; }</style>');
  });

  it('streams the text of an open SVG element without its partial tail', () => {
    const analysis = analyze('svg', '<svg viewBox="0 0 80 20"><text x="2" y="14">Lo', {
      id: 'svg-stream',
      mode: 'stream-preview',
      htmlUiModeEnabled: true,
    });
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    const plan = materializeArtifact(analysis.intent, { mode: 'stream-preview' });
    expect(plan.renderSource).toContain('<text x="2" y="14">Lo</text></svg>');
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

  it('keeps a viewport intent and uses canvas overflow CSS when the host is Canvas', () => {
    const analysis = analyze('artifact-html', '<main style="height:100vh">Workspace</main>', {
      id: 'viewport-host',
    });
    expect(analysis.kind).toBe('intent');
    if (analysis.kind !== 'intent') return;
    expect(analysis.intent.layout).toBe('viewport');
    expect(analysis.intent.surface).toBe('inline');

    const inlinePlan = materializeArtifact(analysis.intent, { mode: 'interactive' });
    expect(inlinePlan.intent.layout).toBe('viewport');
    expect(inlinePlan.intent.surface).toBe('inline');
    expect(inlinePlan.frameMode).toBe('inline-viewport');
    expect(inlinePlan.document.kind).toBe('sandbox');
    if (inlinePlan.document.kind === 'sandbox') {
      expect(inlinePlan.document.srcdoc).toContain('data-frame-mode="inline-viewport"');
      expect(inlinePlan.document.srcdoc).toContain('overflow-x: hidden !important');
    }

    const canvasPlan = materializeArtifact(analysis.intent, {
      mode: 'interactive',
      presentation: 'canvas',
    });
    expect(canvasPlan.intent.layout).toBe('viewport');
    expect(canvasPlan.intent.surface).toBe('inline');
    expect(canvasPlan.frameMode).toBe('canvas');
    expect(canvasPlan.document.kind).toBe('sandbox');
    if (canvasPlan.document.kind === 'sandbox') {
      expect(canvasPlan.document.srcdoc).toContain('data-frame-mode="canvas"');
      expect(canvasPlan.document.srcdoc).toContain('overflow-y: auto !important');
    }
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
