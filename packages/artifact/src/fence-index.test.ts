import { describe, expect, it } from 'vitest';
import { getArtifactFixture } from '../fixtures/index.js';
import { indexArtifactFences } from './fence-index.js';
import { parseFenceSurface, parseFenceTitle } from './fence-syntax.js';

function identity(markdown: string) {
  return indexArtifactFences(markdown).map((fence) => ({
    ordinal: fence.ordinal,
    info: fence.info,
    language: fence.language,
    source: fence.source,
  }));
}

describe('indexArtifactFences', () => {
  it('indexes a backtick fence at offset 0', () => {
    const markdown = '```html\n<div></div>\n```';
    const [fence] = indexArtifactFences(markdown);
    expect(fence).toMatchObject({
      ordinal: 0,
      startOffset: 0,
      endOffset: markdown.length,
      info: 'html',
      language: 'html',
      source: '<div></div>',
      open: false,
    });
  });

  it('indexes a tilde fence', () => {
    const markdown = '~~~html\n<div></div>\n~~~';
    const [fence] = indexArtifactFences(markdown);
    expect(fence).toMatchObject({
      startOffset: 0,
      language: 'html',
      source: '<div></div>',
      open: false,
    });
  });

  it('indexes a 4+ marker fence that contains shorter fences', () => {
    const markdown = '````html\n```\ninner\n```\n````';
    const fences = indexArtifactFences(markdown);
    expect(fences).toHaveLength(1);
    expect(fences[0]?.source).toBe('```\ninner\n```');
    expect(fences[0]?.startOffset).toBe(0);
  });

  it('indexes a blockquote fence at the first marker, not the > prefix', () => {
    const markdown = '> ```html\n> <div></div>\n> ```';
    const [fence] = indexArtifactFences(markdown);
    expect(fence?.startOffset).toBe(markdown.indexOf('```'));
    expect(fence?.source).toBe('<div></div>');
    expect(fence?.open).toBe(false);
  });

  it('strips opening indent from content', () => {
    const markdown = '   ```js\n   foo\n    bar\n   ```';
    const [fence] = indexArtifactFences(markdown);
    expect(fence?.startOffset).toBe(3);
    expect(fence?.source).toBe('foo\n bar');
  });

  it('parses title and surface metadata on the info string', () => {
    const markdown =
      '```artifact-html title="Demo" surface="canvas"\n<main>ui</main>\n```';
    const [fence] = indexArtifactFences(markdown);
    expect(fence?.info).toBe('artifact-html title="Demo" surface="canvas"');
    expect(fence?.language).toBe('artifact-html');
    expect(parseFenceTitle(fence?.info ?? '')).toBe('Demo');
    expect(parseFenceSurface(fence?.info ?? '')).toBe('canvas');
    expect(fence?.source).toBe('<main>ui</main>');
  });

  it('marks an unclosed fence open with a null endOffset', () => {
    const markdown = '```html\n<div>';
    const [fence] = indexArtifactFences(markdown);
    expect(fence).toMatchObject({
      startOffset: 0,
      endOffset: null,
      source: '<div>',
      open: true,
    });
  });

  it('indexes multiple fences with stable ordinals', () => {
    const markdown = ['```ts', 'const a = 1;', '```', '', '```html', '<div>b</div>', '```'].join(
      '\n',
    );
    const fences = indexArtifactFences(markdown);
    expect(fences).toHaveLength(2);
    expect(fences[0]).toMatchObject({
      ordinal: 0,
      language: 'ts',
      source: 'const a = 1;',
    });
    expect(fences[1]).toMatchObject({
      ordinal: 1,
      language: 'html',
      source: '<div>b</div>',
      startOffset: markdown.indexOf('```html'),
    });
  });

  it('uses UTF-16 offsets with 中文 before and after the fence', () => {
    const markdown = '中文前\n```html title="Demo"\n<div></div>\n```\n中文后';
    const [fence] = indexArtifactFences(markdown);
    expect(markdown.slice(0, 3)).toBe('中文前');
    expect(fence?.startOffset).toBe(markdown.indexOf('```'));
    expect(fence?.startOffset).toBe(4);
    expect(fence?.source).toBe('<div></div>');
  });

  it('indexes a nested blockquote fence', () => {
    const markdown = '>> ```html\n>> <div></div>\n>> ```';
    const [fence] = indexArtifactFences(markdown);
    expect(fence?.startOffset).toBe(markdown.indexOf('```'));
    expect(fence?.source).toBe('<div></div>');
  });

  it('yields the same identity fields for a fixture used by Desktop and Mobile collectors', () => {
    const fixture = getArtifactFixture('explicit-canvas');
    const fields = identity(fixture.markdown);
    expect(fields).toEqual(identity(fixture.markdown));
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      ordinal: 0,
      language: 'artifact-html',
      source: fixture.source,
    });
    expect(fields[0]?.info).toContain('surface="canvas"');
  });
});
