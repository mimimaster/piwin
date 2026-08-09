import { describe, expect, it } from 'vitest';
import { splitMarkdownBlocks, tryParseHtmlArtifactFence } from './parser.js';

describe('tryParseHtmlArtifactFence', () => {
  it('promotes artifact-html fences', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: 'artifact-html title="Demo"',
      source: '<button>Hi</button>',
      id: 'a1',
    });
    expect(descriptor?.type).toBe('html');
    expect(descriptor?.title).toBe('Demo');
    expect(descriptor?.surface).toBe('inline');
  });

  it('parses an explicit Canvas surface and safely defaults unknown values', () => {
    const canvas = tryParseHtmlArtifactFence({
      language: 'artifact-html title="Workspace" surface="canvas"',
      source: '<main>Workspace</main>',
      id: 'canvas-1',
    });
    const unknown = tryParseHtmlArtifactFence({
      language: 'artifact-html surface="sideways"',
      source: '<main>Fallback</main>',
      id: 'canvas-2',
    });

    expect(canvas?.surface).toBe('canvas');
    expect(unknown?.surface).toBe('inline');
  });

  it('promotes native html when UI-like and mode on', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: 'html',
      source: '<div class="card"><button>OK</button></div>',
      id: 'a2',
      htmlUiModeEnabled: true,
    });
    expect(descriptor?.type).toBe('html');
  });

  it('does not promote plain html snippets when mode off', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: 'html',
      source: '<div class="card"><button>OK</button></div>',
      id: 'a3',
      htmlUiModeEnabled: false,
    });
    expect(descriptor).toBeNull();
  });

  it('keeps plain code fences as non-artifacts', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'ts',
        source: 'const x = 1',
        id: 'a4',
      }),
    ).toBeNull();
  });

  it('promotes a valid svg fence when Artifact parsing is enabled', () => {
    const descriptor = tryParseHtmlArtifactFence({
      language: 'svg title="Pelican"',
      source: '<?xml version="1.0"?>\n<svg viewBox="0 0 10 10"><circle r="5" /></svg>',
      id: 'svg-1',
      htmlUiModeEnabled: true,
    });
    expect(descriptor).toMatchObject({
      type: 'svg',
      title: 'Pelican',
      rawLanguage: 'svg title="Pelican"',
      alias: 'svg',
    });
    expect(descriptor?.source).toContain('<svg');
  });

  it('keeps svg source as code when Artifact parsing is disabled', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'svg',
        source: '<svg><circle r="5" /></svg>',
        id: 'svg-2',
        htmlUiModeEnabled: false,
      }),
    ).toBeNull();
  });

  it('rejects a non-svg source in an svg fence', () => {
    expect(
      tryParseHtmlArtifactFence({
        language: 'svg',
        source: '<div>not an SVG</div>',
        id: 'svg-3',
        htmlUiModeEnabled: true,
      }),
    ).toBeNull();
  });
});

describe('splitMarkdownBlocks', () => {
  it('splits paragraphs and fenced code with language', () => {
    const blocks = splitMarkdownBlocks('hello\n\n```html\n<div></div>\n```\n');
    expect(blocks.some((block) => block.type === 'paragraph')).toBe(true);
    const code = blocks.find((block) => block.type === 'code');
    expect(code).toMatchObject({ type: 'code', language: 'html' });
  });

  it('parses markdown tables with headers, alignments, and rows', () => {
    const tableMd = `
| Command | Mode | Timeout |
| :--- | :---: | ---: |
| pnpm dev | auto | 5000 |
| pnpm test | manual | 10000 |
`;
    const blocks = splitMarkdownBlocks(tableMd);
    const table = blocks.find((b) => b.type === 'table');
    expect(table).toBeDefined();
    if (table && table.type === 'table') {
      expect(table.headers).toEqual(['Command', 'Mode', 'Timeout']);
      expect(table.alignments).toEqual(['left', 'center', 'right']);
      expect(table.rows).toEqual([
        ['pnpm dev', 'auto', '5000'],
        ['pnpm test', 'manual', '10000'],
      ]);
    }
  });

  it('parses headings, callouts, and ordered lists', () => {
    const md = `
# Title
> [!NOTE]
> Important note text

1. Step one
2. Step two
`;
    const blocks = splitMarkdownBlocks(md);
    expect(blocks.find((b) => b.type === 'heading')).toEqual({
      type: 'heading',
      level: 1,
      text: 'Title',
    });
    expect(blocks.find((b) => b.type === 'blockquote')).toEqual({
      type: 'blockquote',
      text: 'Important note text',
      kind: 'note',
    });
    expect(blocks.find((b) => b.type === 'list')).toEqual({
      type: 'list',
      items: ['Step one', 'Step two'],
      ordered: true,
    });
  });
});
