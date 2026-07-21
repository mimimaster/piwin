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
  });
});
