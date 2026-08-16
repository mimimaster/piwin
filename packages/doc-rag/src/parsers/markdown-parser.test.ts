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
