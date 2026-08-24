import { describe, expect, it } from 'vitest';
import { buildToolPresentation } from './tool-presentation.js';

const DISPLAY_CARD = {
  cardId: 'card-1',
  itemId: 'card-1',
  model: 'basic' as const,
  ordinal: 1,
  deck: 'srs',
  front: 'What is an Artifact?',
  back: 'Untrusted HTML rendered in a sandbox.',
  createdAt: '2026-08-24T00:00:00.000Z',
};

describe('flashcard tool presentation', () => {
  it('attaches structured display from flashcard_create output', () => {
    const presentation = buildToolPresentation({
      toolName: 'flashcard_create',
      outputText: JSON.stringify({
        card: { id: 'card-1', front: 'Q', back: 'A' },
        duplicate: false,
        display: { cards: [DISPLAY_CARD] },
      }),
    });
    expect(presentation.flashcard?.cards).toEqual([DISPLAY_CARD]);
    expect(presentation.output?.text).not.toContain('artifactHtml');
  });

  it('does not attach flashcard display for ordinary HTML output', () => {
    const presentation = buildToolPresentation({
      toolName: 'flashcard_create',
      outputText: '<div class="piwin-flashcard" data-card-id="card-1">Card</div>',
    });
    expect(presentation.flashcard).toBeUndefined();
  });

  it('attaches display for routed flashcard_batch_create', () => {
    const presentation = buildToolPresentation({
      toolName: 'flashcard_batch_create',
      routedToolName: 'flashcard_batch_create',
      outputText: JSON.stringify({
        created: [],
        skipped: [],
        display: { cards: [DISPLAY_CARD] },
      }),
    });
    expect(presentation.flashcard?.cards).toHaveLength(1);
  });
});
