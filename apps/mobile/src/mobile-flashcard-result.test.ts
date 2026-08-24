import { describe, expect, it } from 'vitest';
import { collectMobileArtifacts } from './mobile-artifact-preview.js';
import {
  formatMobileFlashcardResult,
  resolveMobileFlashcardDisplay,
} from './mobile-flashcard-result.js';

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

describe('Mobile flashcard tool-result degradation', () => {
  it('formats structured Q/A text from presentation.flashcard', () => {
    const payload = resolveMobileFlashcardDisplay({
      flashcard: { cards: [CARD] },
    });
    expect(payload).not.toBeNull();
    const text = formatMobileFlashcardResult(payload!);
    expect(text).toContain('Q: What is an Artifact?');
    expect(text).not.toContain('<div');
    expect(text).not.toContain('data-card-id');
  });

  it('ordinary HTML with data-card-id does not become a flashcard renderer', () => {
    const text = [
      '```html',
      '<div class="piwin-flashcard" data-card-id="card-abc12345-xyz">Card</div>',
      '```',
    ].join('\n');
    const items = collectMobileArtifacts(text, true);
    expect(items.every((item) => item.title !== 'Preview card')).toBe(true);
    expect(
      resolveMobileFlashcardDisplay({
        output: '<div class="piwin-flashcard" data-card-id="card-abc12345-xyz">Card</div>',
      }),
    ).toBeNull();
  });
});
