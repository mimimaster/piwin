import { describe, expect, it } from 'vitest';
import { STREAMING_ARTIFACT_FENCE_MARKER } from './constants.js';
import { indexArtifactFences } from './fence-index.js';
import { projectArtifactMarkdownForRender } from './markdown-projection.js';

describe('projectArtifactMarkdownForRender', () => {
  it('returns raw markdown when done', () => {
    const raw = '```html\n<div>x</div>\n```';
    const projection = projectArtifactMarkdownForRender(raw, true);
    expect(projection.markdown).toBe(raw);
    expect(projection.fences).toEqual(indexArtifactFences(raw));
    expect(projection.ordinalByProjectedStartOffset.get(0)).toBe(0);
  });

  it('closes an open native fence when not done and maps the raw start offset', () => {
    const raw = '```html\n<div class="x">hello';
    const projection = projectArtifactMarkdownForRender(raw, false);
    expect(projection.markdown.endsWith('```')).toBe(true);
    expect(projection.fences[0]?.open).toBe(true);
    expect(projection.ordinalByProjectedStartOffset.get(0)).toBe(0);
    expect(indexArtifactFences(projection.markdown)[0]?.open).toBe(false);
  });

  it('marks an open native fence for first-token stream preview', () => {
    const html = projectArtifactMarkdownForRender('```html\n<', false);
    const svg = projectArtifactMarkdownForRender('```svg', false);
    expect(html.markdown).toContain(`\`\`\`html ${STREAMING_ARTIFACT_FENCE_MARKER}\n<`);
    expect(svg.markdown).toContain(`\`\`\`svg ${STREAMING_ARTIFACT_FENCE_MARKER}\n\`\`\``);
    expect(html.ordinalByProjectedStartOffset.get(0)).toBe(0);
  });

  it('does not mark a closed non-UI native fence while later text is streaming', () => {
    const raw = '```html\n<p>code example</p>\n```\nStill writing';
    expect(projectArtifactMarkdownForRender(raw, false).markdown).toBe(raw);
  });

  it('maps 中文 before/after, blockquote, and a synthetic closer onto the same ordinal', () => {
    const raw = ['中文前', '> ```html title="Demo"', '> <div>中文后'].join('\n');
    const projection = projectArtifactMarkdownForRender(raw, false);
    const startOffset = raw.indexOf('```');
    expect(startOffset).toBeGreaterThan(0);
    expect(projection.fences[0]?.startOffset).toBe(startOffset);
    expect(projection.fences[0]?.source).toContain('中文后');
    expect(projection.ordinalByProjectedStartOffset.get(startOffset)).toBe(0);
    expect(projection.markdown.startsWith('中文前')).toBe(true);
    expect(projection.markdown).toContain('中文后');
    expect(projection.markdown.endsWith('> ```')).toBe(true);
    expect(projection.markdown.indexOf('```')).toBe(startOffset);
    expect(indexArtifactFences(projection.markdown)[0]?.open).toBe(false);
  });

  it('does not write the synthetic closer or stream marker back into canonical records', () => {
    const raw = '```html\n<div>';
    const projection = projectArtifactMarkdownForRender(raw, false);
    expect(projection.fences[0]?.info).toBe('html');
    expect(projection.fences[0]?.source).toBe('<div>');
    expect(projection.markdown).toContain(STREAMING_ARTIFACT_FENCE_MARKER);
    expect(projection.fences[0]?.info).not.toContain(STREAMING_ARTIFACT_FENCE_MARKER);
  });
});
