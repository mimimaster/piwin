import { describe, expect, it } from 'vitest';
import { canonicalizeArtifactTagBlocks } from './artifact-tag-canonicalize.js';
import { indexArtifactFences } from './fence-index.js';
import { projectArtifactMarkdownForRender } from './markdown-projection.js';

const TAGGED = [
  '排查结果如下：',
  '',
  '<artifact-html title="推广链接点击排查 · nl-vps" style="host">',
  '<style> .ctf { color: var(--piwin-artifact-text); } </style>',
  '<div class="ctf">ok</div>',
  '</artifact-html>',
  '',
  '以上。',
].join('\n');

describe('tag-form artifacts', () => {
  it('indexes a tag block as an artifact record with fence-equivalent info', () => {
    const [fence] = indexArtifactFences(TAGGED);
    expect(fence).toMatchObject({
      ordinal: 0,
      startOffset: TAGGED.indexOf('<artifact-html'),
      endOffset: TAGGED.indexOf('\n以上') ,
      info: 'artifact-html title="推广链接点击排查 · nl-vps" style="host"',
      language: 'artifact-html',
      source: '<style> .ctf { color: var(--piwin-artifact-text); } </style>\n<div class="ctf">ok</div>',
      open: false,
    });
    expect(fence?.tagBlock?.closing).not.toBeNull();
  });

  it('rewrites the tags into a canonical fence and keeps surrounding prose', () => {
    const canonical = canonicalizeArtifactTagBlocks(TAGGED);
    expect(canonical).toBe([
      '排查结果如下：',
      '',
      '```artifact-html title="推广链接点击排查 · nl-vps" style="host"',
      '<style> .ctf { color: var(--piwin-artifact-text); } </style>',
      '<div class="ctf">ok</div>',
      '```',
      '',
      '以上。',
    ].join('\n'));
    const [original] = indexArtifactFences(TAGGED);
    const [rewritten] = indexArtifactFences(canonical);
    expect(rewritten).toMatchObject({ ordinal: 0, info: original?.info, source: original?.source, open: false });
    expect(rewritten?.tagBlock).toBeUndefined();
  });

  it('keeps ordinals aligned with real fences around a tag block', () => {
    const raw = ['```html', '<p>a</p>', '```', '<artifact-html title="b">', '<p>b</p>', '</artifact-html>', '```svg', '<svg></svg>', '```'].join('\n');
    const before = indexArtifactFences(raw).map((fence) => [fence.ordinal, fence.language, fence.source]);
    const after = indexArtifactFences(canonicalizeArtifactTagBlocks(raw)).map((fence) => [fence.ordinal, fence.language, fence.source]);
    expect(after).toEqual(before);
  });

  it('splits a body that shares lines with the tags', () => {
    const raw = '<artifact-html title="x"><div>a</div>\n<div>b</div></artifact-html>';
    expect(indexArtifactFences(raw)[0]?.source).toBe('<div>a</div>\n<div>b</div>');
    expect(canonicalizeArtifactTagBlocks(raw)).toBe('```artifact-html title="x"\n<div>a</div>\n<div>b</div>\n```');
  });

  it('streams an unclosed tag block as an open fence', () => {
    const raw = '<artifact-html title="x" surface="canvas">\n<div>part';
    const [fence] = indexArtifactFences(raw);
    expect(fence).toMatchObject({ open: true, endOffset: null, source: '<div>part' });
    const canonical = canonicalizeArtifactTagBlocks(raw);
    expect(canonical).toBe('```artifact-html title="x" surface="canvas"\n<div>part');
    const projection = projectArtifactMarkdownForRender(canonical, false);
    expect(indexArtifactFences(projection.markdown)[0]?.open).toBe(false);
  });

  it('uses a longer marker when the body holds a fence-like line', () => {
    const raw = '<artifact-html>\n<pre>\n```js\nx\n```\n</pre>\n</artifact-html>';
    const canonical = canonicalizeArtifactTagBlocks(raw);
    expect(canonical.startsWith('````artifact-html\n')).toBe(true);
    expect(indexArtifactFences(canonical)[0]?.source).toBe('<pre>\n```js\nx\n```\n</pre>');
  });

  it('accepts quoted > in attributes', () => {
    const raw = '<artifact-html title="a > b" style="host">\n<p>x</p>\n</artifact-html>';
    expect(indexArtifactFences(raw)[0]?.info).toBe('artifact-html title="a > b" style="host"');
  });

  it.each([
    '`<artifact-html>` 是旧格式\n<p>x</p>\n</artifact-html>',
    '<artifact-html> is the tag name we used\n</artifact-html>',
    'prose <artifact-html title="x">\n<p>x</p>\n</artifact-html>',
    '    <artifact-html>\n    <p>x</p>\n    </artifact-html>',
    '<artifact-html/>',
    '<artifact-htmlx>\n<p>x</p>\n</artifact-htmlx>',
    '<div>\n<p>x</p>\n</div>',
    '```md\n<artifact-html>\n<p>x</p>\n</artifact-html>\n```',
  ])('leaves non-artifact text alone: %s', (raw) => {
    expect(indexArtifactFences(raw).some((fence) => fence.tagBlock)).toBe(false);
    expect(canonicalizeArtifactTagBlocks(raw)).toBe(raw);
  });
});
