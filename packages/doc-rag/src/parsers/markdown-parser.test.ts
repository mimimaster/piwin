import { describe, expect, it } from 'vitest';
import { createMarkdownParser } from './markdown-parser.js';
import { createTextParser } from './text-parser.js';

describe('markdown parser', () => {
  it('keeps nested heading paths and fenced code', async () => {
    const content = [
      '# Title',
      '',
      'Intro.',
      '',
      '## Section A',
      '',
      '```ts',
      'const x = 1;',
      '```',
      '',
      '### Nested',
      '',
      'Deep text.',
    ].join('\n');
    const parsed = await createMarkdownParser().parse({
      relativePath: 'nested_headings.md',
      extension: '.md',
      content,
      documentId: 'doc1',
    });
    const fence = parsed.blocks.find((block) => block.type === 'code');
    expect(fence?.text).toContain('const x = 1;');
    expect(fence?.headingPath).toEqual(['Title', 'Section A']);
    const nested = parsed.blocks.find((block) => block.text === 'Deep text.');
    expect(nested?.headingPath).toEqual(['Title', 'Section A', 'Nested']);
    expect(nested?.startLine).toBeGreaterThan(1);
  });

  it('strips leading frontmatter and offsets block line numbers to the original file', async () => {
    const content = [
      '---',
      'id: "note-1"',
      'title: "My note"',
      'tags: ["a","b"]',
      'createdAt: "2026-01-01T00:00:00.000Z"',
      'updatedAt: "2026-01-01T00:00:00.000Z"',
      '---',
      '',
      '# Body heading',
      '',
      'Paragraph on original line 11.',
    ].join('\n');
    const parsed = await createMarkdownParser().parse({
      relativePath: 'default/note-1.md',
      extension: '.md',
      content,
      documentId: 'doc-note',
    });
    expect(parsed.title).toBe('My note');
    expect(parsed.metadata).toEqual({
      id: 'note-1',
      title: 'My note',
      tags: ['a', 'b'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const heading = parsed.blocks.find((block) => block.text === 'Body heading');
    expect(heading?.startLine).toBe(9);
    const paragraph = parsed.blocks.find((block) => block.text === 'Paragraph on original line 11.');
    expect(paragraph?.startLine).toBe(11);
    expect(paragraph?.endLine).toBe(11);
  });

  it('omits metadata when there is no frontmatter and keeps body line numbers', async () => {
    const parsed = await createMarkdownParser().parse({
      relativePath: 'plain.md',
      extension: '.md',
      content: '# Title\n\nHello.',
      documentId: 'doc-plain',
    });
    expect(parsed.metadata).toBeUndefined();
    expect(parsed.title).toBe('Title');
    expect(parsed.blocks.find((block) => block.text === 'Hello.')?.startLine).toBe(3);
  });

  it('tolerates hand-edited frontmatter values that are not JSON', async () => {
    const parsed = await createMarkdownParser().parse({
      relativePath: 'hand.md',
      extension: '.md',
      content: '---\ntitle: My raw title\n---\n\nBody.\n',
      documentId: 'doc-hand',
    });
    expect(parsed.metadata?.title).toBe('My raw title');
    expect(parsed.title).toBe('My raw title');
  });
});

describe('text parser', () => {
  it('strips BOM and splits paragraphs', async () => {
    const content = `\uFEFFFirst paragraph.\n\nSecond paragraph.`;
    const parsed = await createTextParser().parse({
      relativePath: 'bom.txt',
      extension: '.txt',
      content,
      documentId: 'doc2',
    });
    expect(parsed.blocks.map((block) => block.text)).toEqual([
      'First paragraph.',
      'Second paragraph.',
    ]);
    expect(parsed.blocks[0]?.startLine).toBe(1);
  });
});
