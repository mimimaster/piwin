import { describe, expect, it } from 'vitest';
import { resolveArtifactRenderTarget } from './render-route.js';
import type { ArtifactDescriptor } from './types.js';

function descriptor(source: string, type: 'html' | 'svg' = 'html'): ArtifactDescriptor {
  return {
    id: 'artifact-route-test',
    type,
    title: type === 'svg' ? 'SVG' : 'HTML UI',
    source,
    rawLanguage: type === 'svg' ? 'svg' : 'artifact-html',
    alias: type === 'svg' ? 'svg' : 'artifact-html',
    declaration: type === 'svg' ? 'native' : 'explicit',
    documentKind: 'fragment',
    surface: 'inline',
  };
}

describe('resolveArtifactRenderTarget', () => {
  it('routes completed static HTML and SVG into natural transcript flow', () => {
    const html = '<style>.card{padding:12px}</style><section class="card">Hello</section>';
    expect(
      resolveArtifactRenderTarget({
        descriptor: descriptor(html),
        mode: 'interactive',
        source: html,
      }),
    ).toBe('static-flow');

    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><circle cx="50" cy="30" r="20" /></svg>';
    expect(
      resolveArtifactRenderTarget({
        descriptor: descriptor(svg, 'svg'),
        mode: 'interactive',
        source: svg,
      }),
    ).toBe('static-flow');
  });

  it('does not treat visible URL text as a loaded external resource', () => {
    const source = '<p>Documentation: https://example.com/reference</p>';
    expect(
      resolveArtifactRenderTarget({
        descriptor: descriptor(source),
        mode: 'interactive',
        source,
      }),
    ).toBe('static-flow');
  });

  it.each([
    '<script>window.ready = true</script><div>Interactive</div>',
    '<button onclick="openPanel()">Open</button>',
    '<a href="javascript:alert(1)">Open</a>',
    '<iframe src="https://www.youtube.com/embed/demo"></iframe>',
    '<style>@import "https://cdn.example.com/ui.css"</style><div>UI</div>',
    '<img src="/generated/chart.png" alt="Chart">',
    '<div style="background-image:url(https://cdn.example.com/card.png)">UI</div>',
    '<style>:host { min-height: 100vh }</style><div>UI</div>',
    '<form><button>Submit</button></form>',
  ])('keeps active or externally-referenced source sandboxed: %s', (source) => {
    expect(
      resolveArtifactRenderTarget({
        descriptor: descriptor(source),
        mode: 'interactive',
        source,
      }),
    ).toBe('sandbox');
  });

  it('keeps streaming and Canvas content sandboxed even when the current snapshot is static', () => {
    const source = '<div>Still generating</div>';
    const inline = descriptor(source);
    expect(
      resolveArtifactRenderTarget({ descriptor: inline, mode: 'stream-preview', source }),
    ).toBe('sandbox');

    expect(
      resolveArtifactRenderTarget({
        descriptor: { ...inline, surface: 'canvas' },
        mode: 'interactive',
        source,
      }),
    ).toBe('sandbox');
  });
});
