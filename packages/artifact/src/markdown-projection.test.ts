import { describe, expect, it } from 'vitest';
import { STREAMING_ARTIFACT_FENCE_MARKER } from './constants.js';
import { indexArtifactFences } from './fence-index.js';
import { projectArtifactMarkdownForRender } from './markdown-projection.js';

describe('projectArtifactMarkdownForRender', () => {
  it.each([true, false])('recovers a prose-glued animation fence without changing raw source (done=%s)', (done) => {
    const raw = '做了一幅骑行动画。```artifact-html title="骑车" surface="canvas"\n<!DOCTYPE html>\n<html><body>骑行</body></html>' + (done ? '\n```' : '');
    const projection = projectArtifactMarkdownForRender(raw, done);
    expect(projection.markdown).toContain('动画。\n\n```artifact-html');
    expect(projection.fences).toHaveLength(1);
    expect(projection.fences[0]).toMatchObject({
      startOffset: raw.indexOf('```'), recoveredOpening: true, open: !done,
      info: 'artifact-html title="骑车" surface="canvas"', source: '<!DOCTYPE html>\n<html><body>骑行</body></html>',
    });
    const rendered = indexArtifactFences(projection.markdown);
    expect(rendered[0]?.open).toBe(false);
    expect(projection.ordinalByProjectedStartOffset.get(rendered[0]?.startOffset ?? -1)).toBe(0);
    expect(projection.fences[0]?.source).not.toContain('```');
  });

  it('maps multiple recovered fences followed by a streaming native fence', () => {
    const raw = '一。```artifact-html\n<html>1</html>\n```\n二。```artifact-html\n<html>2</html>\n```\n```html\n<';
    const projection = projectArtifactMarkdownForRender(raw, false);
    expect(projection.fences).toHaveLength(3);
    for (const rendered of indexArtifactFences(projection.markdown)) {
      expect(projection.ordinalByProjectedStartOffset.get(rendered.startOffset)).toBe(rendered.ordinal);
    }
    expect(projection.markdown).toContain(STREAMING_ARTIFACT_FENCE_MARKER);
  });

  it.each([
    '用 ```artifact-html 这个名字\nnot an HTML document',
    '`例子 ```artifact-html`\n<html>example</html>',
    '普通 ```html\n<html>example</html>',
    '> 引用 ```artifact-html\n<html>example</html>',
    '````md\n说明。```artifact-html\n<html>example</html>\n```\n````',
  ])('does not promote inline examples or fences nested inside code', (raw) => {
    expect(projectArtifactMarkdownForRender(raw, true).markdown).toBe(raw);
    expect(indexArtifactFences(raw).some((fence) => fence.recoveredOpening)).toBe(false);
  });

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
