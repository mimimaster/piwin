import type { FlashcardToolResultFixture } from './types.js';

const CARD = {
  id: 'card-fixture-artifact-1',
  model: 'basic' as const,
  deck: 'srs',
  front: 'What is an Artifact?',
  back: 'Untrusted HTML rendered in a sandbox.',
  createdAt: '2026-08-24T00:00:00.000Z',
};

const DISPLAY_CARD = {
  cardId: CARD.id,
  itemId: CARD.id,
  model: CARD.model,
  ordinal: 1,
  deck: CARD.deck,
  front: CARD.front,
  back: CARD.back,
  createdAt: CARD.createdAt,
};

const PAYLOAD = {
  card: CARD,
  duplicate: false as const,
  display: { cards: [DISPLAY_CARD] },
};

export const FLASHCARD_TOOL_RESULT: FlashcardToolResultFixture = {
  ok: true,
  output: JSON.stringify(PAYLOAD, null, 2),
  parsed: PAYLOAD,
};
