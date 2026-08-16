import { describe, expect, it } from 'vitest';
import type { ParsedDocument } from '@piwin/contracts';
import { createMarkdownParser } from '../parsers/markdown-parser.js';
import { chunkParsedDocument } from './chunk-service.js';

function parsedFromBlocks(blocks: ParsedDocument['blocks']): ParsedDocument {
  return {
    documentId: 'doc-stable',
    relativePath: 'guide.md',
    blocks,
    parser: { id: 'markdown-v1', version: '1' },
  };
}

describe('chunkParsedDocument', () => {
  it('does not merge blocks across different headings', async () => {
    const chunks = await chunkParsedDocument({
      parsed: parsedFromBlocks([
        {
          blockId: 'b0',
          order: 0,
          type: 'paragraph',
          text: 'Alpha body.',
          headingPath: ['A'],
          startLine: 1,
          endLine: 1,
        },
        {
          blockId: 'b1',
          order: 1,
          type: 'paragraph',
          text: 'Beta body.',
          headingPath: ['B'],
          startLine: 3,
          endLine: 3,
        },
      ]),
      folderKey: 'folder',
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.headingPath).toEqual(['A']);
    expect(chunks[1]?.headingPath).toEqual(['B']);
  });

  it('links prev/next and is stable across two runs', async () => {
    const parsed = await createMarkdownParser().parse({
      relativePath: 'guide.md',
      extension: '.md',
      content: '# One\n\nHello.\n\n# Two\n\nWorld.',
      documentId: 'doc-stable',
    });
    const first = await chunkParsedDocument({ parsed, folderKey: 'folder' });
    const second = await chunkParsedDocument({ parsed, folderKey: 'folder' });
    expect(first.map((chunk) => chunk.chunkId)).toEqual(second.map((chunk) => chunk.chunkId));
    expect(first[0]?.nextChunkId).toBe(first[1]?.chunkId);
    expect(first[1]?.previousChunkId).toBe(first[0]?.chunkId);
  });

  it('splits text that exceeds the hard max', async () => {
    const huge = 'word '.repeat(4000);
    const chunks = await chunkParsedDocument({
      parsed: parsedFromBlocks([
        { blockId: 'b0', order: 0, type: 'paragraph', text: huge, startLine: 1, endLine: 1 },
      ]),
      folderKey: 'folder',
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount <= 1500)).toBe(true);
  });
});
