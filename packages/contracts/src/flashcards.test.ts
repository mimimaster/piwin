import { describe, expect, it } from 'vitest';
import type {
  FlashcardReviewCard,
  FlashcardSelectionExplainInput,
  FlashcardSelectionExplanation,
} from './flashcards.js';
import {
  formatFlashcardDisplayText,
  isFlashcardCreateToolName,
  parseFlashcardDisplayPayload,
} from './flashcards.js';

const CARD: FlashcardReviewCard = {
  cardId: 'card-1',
  itemId: 'card-1',
  model: 'basic',
  ordinal: 1,
  deck: 'srs',
  front: 'What is an Artifact?',
  back: 'Untrusted HTML rendered in a sandbox.',
  createdAt: '2026-08-24T00:00:00.000Z',
};

describe('flashcard tutor contracts', () => {
  it('accepts explain input and explanation result shapes', () => {
    const input: FlashcardSelectionExplainInput = {
      explanationId: 'exp-1',
      itemId: 'card-1',
      face: 'front',
      selectedText: 'closure',
      intent: 'hint',
      locale: 'en',
    };
    const explanation: FlashcardSelectionExplanation = {
      explanationId: 'exp-1',
      itemId: 'card-1',
      selectedText: 'closure',
      intent: 'hint',
      markdown: 'Think about captured variables.',
    };
    expect(input.face).toBe('front');
    expect(explanation.markdown.length).toBeGreaterThan(0);
  });
});

describe('flashcard display payload', () => {
  it('parses display.cards from a create tool result', () => {
    const payload = parseFlashcardDisplayPayload({
      card: { id: 'card-1', front: 'Q', back: 'A' },
      duplicate: false,
      display: { cards: [CARD] },
    });
    expect(payload?.cards).toEqual([CARD]);
  });

  it('parses a JSON string and ignores leftover artifactHtml', () => {
    const payload = parseFlashcardDisplayPayload(
      JSON.stringify({
        created: [],
        skipped: [],
        artifactHtml: '<div class="piwin-flashcard" data-card-id="card-1"></div>',
        display: { cards: [CARD] },
      }),
    );
    expect(payload?.cards[0]?.front).toBe('What is an Artifact?');
  });

  it('does not treat ordinary HTML with data-card-id as a display payload', () => {
    expect(
      parseFlashcardDisplayPayload(
        '<div class="piwin-flashcard" data-card-id="card-abc12345-xyz">Card</div>',
      ),
    ).toBeNull();
    expect(
      parseFlashcardDisplayPayload({
        artifactHtml: '<div data-card-id="card-1"></div>',
      }),
    ).toBeNull();
  });

  it('formats structured Q/A text without HTML', () => {
    const text = formatFlashcardDisplayText({ cards: [CARD] });
    expect(text).toBe('Q: What is an Artifact?\nA: Untrusted HTML rendered in a sandbox.');
    expect(text).not.toContain('<');
    expect(text).not.toContain('data-card-id');
  });

  it('numbers multi-card text', () => {
    const second: FlashcardReviewCard = {
      ...CARD,
      cardId: 'card-2',
      itemId: 'card-2',
      front: 'Q2',
      back: 'A2',
    };
    const text = formatFlashcardDisplayText({ cards: [CARD, second] });
    expect(text).toContain('1. Q: What is an Artifact?');
    expect(text).toContain('2. Q: Q2');
  });

  it('recognizes create tool names', () => {
    expect(isFlashcardCreateToolName('flashcard_create')).toBe(true);
    expect(isFlashcardCreateToolName('flashcard_batch_create')).toBe(true);
    expect(isFlashcardCreateToolName('piwin_toolbox')).toBe(false);
    expect(isFlashcardCreateToolName(undefined)).toBe(false);
  });
});
