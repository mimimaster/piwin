import { describe, expect, it, vi } from 'vitest';
import type { FolderRag } from '@piwin/doc-rag';
import { FLASHCARD_QUALITY_RULES } from '@piwin/doc-rag';
import { assembleDoccardsGeneratePrompt } from './doccards-generate.js';

function createRag(chunks: Array<{ filePath: string; content: string }>): FolderRag {
  return {
    hasEmbeddingProvider: false,
    scanFolder: vi.fn(),
    indexFolder: vi.fn(async () => ({
      indexed: chunks.length,
      chunks: chunks.length,
      degraded: true,
      skipped: 0,
      warnings: [],
    })),
    retrieve: vi.fn(async () =>
      chunks.map((chunk) => ({
        filePath: chunk.filePath,
        content: chunk.content,
        startLine: 1,
        endLine: 2,
        language: 'markdown',
        score: 1,
        snippet: chunk.content.slice(0, 40),
      })),
    ),
    listDocuments: vi.fn(async () => []),
    isIndexed: vi.fn(async () => true),
    close: vi.fn(),
  };
}

describe('assembleDoccardsGeneratePrompt (--legacy-print-prompt)', () => {
  it('indexes then retrieves and returns a prompt, without touching CardStore', async () => {
    const create = vi.fn();
    const rag = createRag([{ filePath: 'srs.md', content: 'Spaced repetition fights forgetting.' }]);
    const prompt = await assembleDoccardsGeneratePrompt({
      rag,
      folderPath: '/docs/Notes',
      topic: '间隔重复',
    });
    expect(rag.indexFolder).not.toHaveBeenCalled();
    expect(rag.retrieve).toHaveBeenCalledWith(
      '/docs/Notes',
      '间隔重复',
      expect.objectContaining({ limit: 10 }),
    );
    expect(prompt).toContain(FLASHCARD_QUALITY_RULES);
    expect(prompt).toContain('srs.md');
    expect(create).not.toHaveBeenCalled();
  });

  it('uses the folder path as retrieve query when topic is empty (current default)', async () => {
    const rag = createRag([{ filePath: 'a.md', content: 'Alpha content for retrieve.' }]);
    await assembleDoccardsGeneratePrompt({ rag, folderPath: '/abs/Notes' });
    expect(rag.retrieve).toHaveBeenCalledWith(
      '/abs/Notes',
      'Notes',
      expect.objectContaining({ limit: 10 }),
    );
  });

  it('throws when retrieve returns no passages', async () => {
    const rag = createRag([]);
    await expect(
      assembleDoccardsGeneratePrompt({ rag, folderPath: '/docs/Notes', topic: 'x' }),
    ).rejects.toThrow(/No passages retrieved/);
  });
});
