import { describe, expect, it } from 'vitest';
import {
  buildStableArtifactRevealFrames,
  buildStreamableArtifactPreview,
  projectHtmlSourceForStreamRoot,
} from './streamable-preview.js';

describe('projectHtmlSourceForStreamRoot', () => {
  it('flattens a full HTML document into styles plus body markup', () => {
    const source = [
      '<!DOCTYPE html>',
      '<html lang="zh-CN"><head><style>.sky{color:blue}</style></head>',
      '<body><div class="sky">鹈鹕</div><script>window.ready=1</script></body>',
      '</html>',
    ].join('');
    expect(projectHtmlSourceForStreamRoot(source)).toBe(
      '<style>.sky{color:blue}</style><div class="sky">鹈鹕</div><script>window.ready=1</script>',
    );
  });

  it('leaves fragment sources unchanged', () => {
    const source = '<style>.a{}</style><section>Hi</section>';
    expect(projectHtmlSourceForStreamRoot(source)).toBe(source);
  });
});

describe('buildStreamableArtifactPreview', () => {
  it('strips incomplete script tails', () => {
    const source = '<div><p>Hi</p></div><script>alert(1)';
    const result = buildStreamableArtifactPreview(source);
    expect(result.canStream).toBe(true);
    expect(result.previewSource).not.toContain('<script');
    expect(result.previewSource).toContain('<p>Hi</p>');
  });

  it('strips inline handlers and javascript urls', () => {
    const source = '<div><a href="javascript:alert(1)" onclick="x()">x</a></div>';
    const result = buildStreamableArtifactPreview(source);
    expect(result.previewSource).not.toMatch(/onclick/i);
    expect(result.previewSource).not.toMatch(/javascript:/i);
  });

  it('returns canStream false for empty source', () => {
    expect(buildStreamableArtifactPreview('   ')).toEqual({
      canStream: false,
      previewSource: '   ',
    });
  });

  it('builds preview from partial nested structure', () => {
    const source = '<section><div><p>One</p></div><div><p>Two';
    const result = buildStreamableArtifactPreview(source);
    expect(result.canStream).toBe(true);
    expect(result.previewSource).toBe(
      '<section><div><p>One</p></div><div><p>Two</p></div></section>',
    );
  });

  it('streams text of an open element once the CSS foundation is complete', () => {
    const streaming = buildStreamableArtifactPreview(
      '<style>.card { color: red; }</style><div class="card"><h2>Generat',
    );
    const withoutFoundation = buildStreamableArtifactPreview(
      '<style>.card { color: red; <div class="card"><h2>Generat',
    );
    expect(streaming).toEqual({
      canStream: true,
      previewSource:
        '<style>.card { color: red; }</style><div class="card"><h2>Generat</h2></div>',
    });
    expect(withoutFoundation.canStream).toBe(false);
  });

  it('keeps waiting while a prefix only opens containers or paint servers', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">';
    expect(buildStreamableArtifactPreview(svg).canStream).toBe(false);
    expect(
      buildStreamableArtifactPreview(
        `${svg}\n  <!-- Sky -->\n  <defs><linearGradient id="sky"><stop offset="0" stop-color="#87ceeb"/>`,
      ).canStream,
    ).toBe(false);
    expect(
      buildStreamableArtifactPreview(
        '<style>.a{color:red}</style><div class="wrap">\n  <div class="grid">',
      ).canStream,
    ).toBe(false);
  });

  it('streams once a shape or text paints outside paint servers', () => {
    const svg = '<svg viewBox="0 0 400 300"><defs><linearGradient id="sky"></linearGradient></defs>';
    expect(buildStreamableArtifactPreview(`${svg}<rect width="400" height="300"/>`).canStream).toBe(
      true,
    );
    expect(
      buildStreamableArtifactPreview('<style>.a{color:red}</style><div class="wrap"><h2>T').canStream,
    ).toBe(true);
  });

  it('stops trailing text before a partial tag or character reference', () => {
    expect(buildStreamableArtifactPreview('<div><p>Tom &amp; Je</p><p>A <sp').previewSource).toBe(
      '<div><p>Tom &amp; Je</p><p>A </p></div>',
    );
    expect(buildStreamableArtifactPreview('<div><p>Tom &am').previewSource).toBe(
      '<div><p>Tom </p></div>',
    );
  });

  it('reveals only completed visual siblings', () => {
    const result = buildStreamableArtifactPreview(
      [
        '<style>.scene { display: grid; } .sun { color: gold; }</style>',
        '<div class="scene"><div class="sun">sun</div><div class="pelican"',
      ].join(''),
    );
    expect(result.canStream).toBe(true);
    expect(result.previewSource).toContain('<div class="sun">sun</div>');
    expect(result.previewSource).not.toContain('pelican');
  });

  it('keeps unfinished tags out of the visible snapshot', () => {
    const result = buildStreamableArtifactPreview('<div><p>Stable</p><section cla');
    expect(result.canStream).toBe(true);
    expect(result.previewSource).toBe('<div><p>Stable</p></div>');
    expect(result.previewSource).not.toContain('section cla');
  });

  it('does not mistake a greater-than sign inside an attribute for a tag boundary', () => {
    const result = buildStreamableArtifactPreview('<div class="card" data-label="a > b"');
    expect(result.canStream).toBe(false);
  });

  it('waits for a complete style block before applying it', () => {
    const result = buildStreamableArtifactPreview(
      '<div class="card">Stable</div><style>.card { color: red;',
    );
    expect(result.canStream).toBe(false);
    expect(result.previewSource).toBe('<div class="card">Stable</div>');
    expect(result.previewSource).not.toContain('<style');
  });

  it('keeps an earlier stable component while a CSS-dependent sibling is unfinished', () => {
    const result = buildStreamableArtifactPreview(
      [
        '<main><p>Already stable</p></main>',
        '<div class="next-scene">not ready</div>',
        '<style>.next-scene { display: grid;',
      ].join(''),
    );

    expect(result).toEqual({
      canStream: true,
      previewSource: '<main><p>Already stable</p></main>',
    });
  });

  it('retains the styled snapshot while a later style block is unfinished', () => {
    const result = buildStreamableArtifactPreview(
      [
        '<style>.card { color: red; }</style>',
        '<main class="card"><p>Still stable</p></main>',
        '<style>.card { background: black;',
      ].join(''),
    );

    expect(result.canStream).toBe(true);
    expect(result.previewSource).toContain('<main class="card"><p>Still stable</p></main>');
    expect(result.previewSource).not.toContain('background: black');
  });

  it('withholds a CSS-dependent scene instead of painting an unstyled intermediate', () => {
    const unstyledScene = [
      '<div id="pelican-app" class="pelican-container">',
      '<svg class="pelican" viewBox="0 0 100 60">',
      '<circle class="body" cx="50" cy="30" r="20" />',
      '</svg>',
      '</div>',
    ].join('');

    const beforeStyle = buildStreamableArtifactPreview(unstyledScene);
    const incompleteStyle = buildStreamableArtifactPreview(
      `${unstyledScene}<style>.pelican-container { display: grid;`,
    );
    const styled = buildStreamableArtifactPreview(
      `${unstyledScene}<style>.pelican-container { display: grid; }</style>`,
    );

    expect(beforeStyle.canStream).toBe(false);
    expect(incompleteStyle.canStream).toBe(false);
    expect(styled.canStream).toBe(true);
    expect(styled.previewSource.startsWith('<style>')).toBe(true);
    expect(styled.previewSource).toContain('.pelican-container { display: grid; }');
  });

  it('stages a large late-style scene through bounded stable frames', () => {
    const source = [
      '<div class="scene">',
      '<div class="sky">sky</div>',
      '<div class="road">road</div>',
      '<div class="bicycle">bicycle</div>',
      '<div class="pelican">pelican</div>',
      '</div>',
      '<style>.scene { display: grid; } .pelican { color: white; }</style>',
    ].join('');
    const preview = buildStreamableArtifactPreview(source);
    const frames = buildStableArtifactRevealFrames(preview.previewSource, 4);

    expect(preview.canStream).toBe(true);
    expect(frames.length).toBeGreaterThan(1);
    expect(frames.length).toBeLessThanOrEqual(4);
    expect(frames[0]?.startsWith('<style>')).toBe(true);
    expect(frames[0]).toContain('sky');
    expect(frames[0]).not.toContain('pelican</div>');
    expect(frames.at(-1)).toBe(preview.previewSource);
  });

  it('builds a partial SVG snapshot at complete tag boundaries', () => {
    const result = buildStreamableArtifactPreview(
      '<svg viewBox="0 0 100 30"><text x="4" y="20">Hello</text><circle cx="',
    );
    expect(result.canStream).toBe(true);
    expect(result.previewSource).toBe(
      '<svg viewBox="0 0 100 30"><text x="4" y="20">Hello</text></svg>',
    );
  });
});
