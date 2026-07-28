import { describe, expect, it } from 'vitest';
import { buildFlashcardGenerationPrompt } from './prompt-builder.js';
import { FLASHCARD_QUALITY_RULES } from './quality-rules.js';
import type { RetrievedChunk } from '@piwin/contracts';

const sampleChunks: RetrievedChunk[] = [
  {
    filePath: 'docs/intro.md',
    content: 'Spaced repetition is a learning technique.',
    startLine: 1,
    endLine: 1,
    language: 'markdown',
    score: 1.0,
    snippet: 'Spaced repetition is a learning technique.',
  },
  {
    filePath: 'src/app.ts',
    content: 'function main() { return 0; }',
    startLine: 10,
    endLine: 12,
    language: 'typescript',
    score: 0.8,
    snippet: 'function main() { return 0; }',
  },
];

describe('buildFlashcardGenerationPrompt', () => {
  it('includes folder path, passages, and quality rules', () => {
    const prompt = buildFlashcardGenerationPrompt({
      folderPath: '/home/user/docs',
      chunks: sampleChunks,
      qualityRules: FLASHCARD_QUALITY_RULES,
    });
    expect(prompt).toContain('/home/user/docs');
    expect(prompt).toContain('docs/intro.md:1-1');
    expect(prompt).toContain('src/app.ts:10-12');
    expect(prompt).toContain('Spaced repetition is a learning technique.');
    expect(prompt).toContain(FLASHCARD_QUALITY_RULES);
    expect(prompt).toContain('sourceFolder');
    expect(prompt).toContain('sourceFile');
    expect(prompt).toContain('sourceLine');
  });

  it('includes topic, difficulty, count guidance when provided', () => {
    const prompt = buildFlashcardGenerationPrompt({
      folderPath: '/docs',
      chunks: sampleChunks,
      topic: 'spaced repetition',
      difficulty: 'hard',
      count: 'more',
      qualityRules: FLASHCARD_QUALITY_RULES,
    });
    expect(prompt).toContain('Topic focus: spaced repetition');
    expect(prompt).toContain('Target difficulty: hard');
    expect(prompt).toContain('larger set');
  });

  it('omits guidance when not provided', () => {
    const prompt = buildFlashcardGenerationPrompt({
      folderPath: '/docs',
      chunks: [],
      qualityRules: 'RULES',
    });
    expect(prompt).not.toContain('Topic focus');
    expect(prompt).not.toContain('Target difficulty');
    expect(prompt).not.toContain('cards)');
  });
});

describe('FLASHCARD_QUALITY_RULES', () => {
  it('mentions batch_create, dedup, and source types', () => {
    expect(FLASHCARD_QUALITY_RULES).toContain('flashcard_batch_create');
    expect(FLASHCARD_QUALITY_RULES).toContain('flashcard_list');
    expect(FLASHCARD_QUALITY_RULES).toContain('Folder/docs');
    expect(FLASHCARD_QUALITY_RULES).toContain('Notes');
    expect(FLASHCARD_QUALITY_RULES).toContain('Open');
  });
});
