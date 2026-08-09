import { describe, expect, it } from 'vitest';
import { buildStreamableArtifactPreview } from './streamable-preview.js';

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
    expect(result.previewSource).toContain('<p>One</p>');
    expect(result.previewSource).toContain('<p>Two</p>');
  });

  it('streams plain text after a complete opening tag', () => {
    const result = buildStreamableArtifactPreview('<div class="card"><h2>Generat');
    expect(result).toEqual({
      canStream: true,
      previewSource: '<div class="card"><h2>Generat</h2></div>',
    });
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
    expect(result.canStream).toBe(true);
    expect(result.previewSource).toBe('<div class="card">Stable</div>');
    expect(result.previewSource).not.toContain('<style');
  });

  it('builds a partial SVG snapshot at complete tag boundaries', () => {
    const result = buildStreamableArtifactPreview(
      '<svg viewBox="0 0 100 30"><text x="4" y="20">Hel',
    );
    expect(result.canStream).toBe(true);
    expect(result.previewSource).toBe(
      '<svg viewBox="0 0 100 30"><text x="4" y="20">Hel</text></svg>',
    );
  });
});
