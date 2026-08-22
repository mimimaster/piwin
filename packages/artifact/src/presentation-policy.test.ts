import { describe, expect, it } from 'vitest';
import { resolveArtifactPresentation } from './presentation-policy.js';
import type { ArtifactDescriptor } from './types.js';

function descriptor(
  source: string,
  overrides: Partial<ArtifactDescriptor> = {},
): ArtifactDescriptor {
  return {
    id: 'artifact-policy',
    type: 'html',
    title: 'Policy fixture',
    source,
    rawLanguage: 'artifact-html',
    alias: 'artifact-html',
    declaration: 'explicit',
    documentKind: 'fragment',
    surface: 'inline',
    ...overrides,
  };
}

describe('resolveArtifactPresentation', () => {
  it('keeps native HTML source-first and previews full documents in Canvas', () => {
    const source = '<!DOCTYPE html><html><body><main>App</main></body></html>';
    expect(
      resolveArtifactPresentation({
        descriptor: descriptor(source, {
          declaration: 'native',
          documentKind: 'document',
          rawLanguage: 'html',
          alias: 'html',
        }),
        mode: 'interactive',
        source,
      }),
    ).toEqual({ kind: 'source', previewSurface: 'canvas' });
  });

  it('keeps a native fence source-first even when its metadata requests Canvas', () => {
    const source = '<section>Native source</section>';
    expect(
      resolveArtifactPresentation({
        descriptor: descriptor(source, {
          declaration: 'native',
          rawLanguage: 'html surface="canvas"',
          alias: 'html',
          surface: 'canvas',
        }),
        mode: 'interactive',
        source,
      }),
    ).toEqual({ kind: 'source', previewSurface: 'canvas' });
  });

  it('rejects the real calligraphy viewport patterns from Inline', () => {
    const source = `
      <style>
        .paper { width:min(100%,calc(100vh - 205px),760px); }
        .panel { max-height:calc(100vh - 130px); overflow:auto; }
      </style>
      <canvas></canvas>
      <script>canvas.height = window.innerHeight;</script>
    `;
    const result = resolveArtifactPresentation({
      descriptor: descriptor(source),
      mode: 'interactive',
      source,
    });

    expect(result.kind).toBe('inline-incompatible');
    if (result.kind === 'inline-incompatible') {
      expect(result.issues).toEqual(
        expect.arrayContaining(['viewport-unit', 'viewport-height-script']),
      );
    }
  });

  it('uses natural flow for inert fragments and sandbox flow for script components', () => {
    const staticSource = '<section><h2>Summary</h2></section>';
    const interactiveSource =
      '<button id="go">Go</button><script>go.onclick=()=>go.remove()</script>';

    expect(
      resolveArtifactPresentation({
        descriptor: descriptor(staticSource),
        mode: 'interactive',
        source: staticSource,
      }),
    ).toEqual({ kind: 'inline-static' });
    expect(
      resolveArtifactPresentation({
        descriptor: descriptor(interactiveSource),
        mode: 'interactive',
        source: interactiveSource,
      }),
    ).toEqual({ kind: 'inline-sandbox' });
  });

  it('never lets diagnostics silently change an explicit Canvas surface', () => {
    const source = '<main style="height:100vh">Workspace</main>';
    expect(
      resolveArtifactPresentation({
        descriptor: descriptor(source, { surface: 'canvas', documentKind: 'document' }),
        mode: 'interactive',
        source,
      }),
    ).toEqual({ kind: 'canvas' });
  });
});
