import { describe, expect, it } from 'vitest';
import { formatCliFlashcardToolResult } from './flashcard-tool-result.js';

const CARD = {
  cardId: 'card-1',
  itemId: 'card-1',
  model: 'basic' as const,
  ordinal: 1,
  deck: 'srs',
  front: 'What is an Artifact?',
  back: 'Untrusted HTML rendered in a sandbox.',
  createdAt: '2026-08-24T00:00:00.000Z',
};

describe('CLI flashcard tool-result degradation', () => {
  it('prints structured Q/A text from presentation.flashcard', () => {
    const text = formatCliFlashcardToolResult({
      kind: 'other',
      title: 'flashcard_create',
      flashcard: { cards: [CARD] },
    });
    expect(text).toBe('Q: What is an Artifact?\nA: Untrusted HTML rendered in a sandbox.');
    expect(text).not.toContain('<div');
    expect(text).not.toContain('data-card-id');
    expect(text).not.toContain('artifactHtml');
  });

  it('does not treat ordinary HTML with data-card-id as a flashcard result', () => {
    expect(
      formatCliFlashcardToolResult(
        { kind: 'other', title: 'bash' },
        '<div class="piwin-flashcard" data-card-id="card-abc12345-xyz">Card</div>',
      ),
    ).toBeNull();
  });
});
