import { describe, it, expect } from 'vitest';
import {
  formatCardMarkdown,
  formatDeckMarkdown,
  formatCardsAnkiTsv,
} from './knowledge-export';
import type { FlashcardItem } from '@piwin/contracts';

describe('knowledge-export', () => {
  const sampleCard: FlashcardItem = {
    id: 'card-1',
    model: 'basic',
    createdAt: '2026-08-17T00:00:00Z',
    front: 'What is FSRS?',
    back: 'Free Spaced Repetition Scheduler algorithm.',
    deck: 'Algorithms',
    sourceFile: 'docs/fsrs.md',
    sourceLine: 42,
    sourceExcerpt: 'FSRS computes interval based on stability and difficulty.',
  };

  it('formats single card as markdown', () => {
    const md = formatCardMarkdown(sampleCard);
    expect(md).toContain('### Q: What is FSRS?');
    expect(md).toContain('**A:** Free Spaced Repetition Scheduler algorithm.');
    expect(md).toContain('> 📄 *Source: docs/fsrs.md:42*');
    expect(md).toContain('> *Excerpt: "FSRS computes interval based on stability and difficulty."*');
    expect(md).toContain('`#Algorithms`');
  });

  it('formats deck as markdown document', () => {
    const doc = formatDeckMarkdown('Test Deck', [sampleCard]);
    expect(doc).toContain('# 🗂️ Test Deck (1 Cards)');
    expect(doc).toContain('## Card 1');
    expect(doc).toContain('### Q: What is FSRS?');
  });

  it('formats cards as Anki TSV', () => {
    const tsv = formatCardsAnkiTsv([sampleCard]);
    expect(tsv).toBe(
      'What is FSRS?\tFree Spaced Repetition Scheduler algorithm.\tAlgorithms\tdocs/fsrs.md:42',
    );
  });
});
