import type { FlashcardItem } from '@piwin/contracts';

/** Cards shown in the TearDeck overlay for a library click. */
export function cardsForBrowse(
  cards: readonly FlashcardItem[],
  clickedId: string,
): FlashcardItem[] {
  const clicked = cards.find((card) => card.id === clickedId);
  if (!clicked) return [];
  const sequenceId = clicked.sequenceId;
  if (!sequenceId) return [clicked];
  return cards
    .filter((card) => card.sequenceId === sequenceId)
    .slice()
    .sort((left, right) => (left.position ?? 0) - (right.position ?? 0));
}

export function browseStartIndex(cards: readonly FlashcardItem[], clickedId: string): number {
  const index = cards.findIndex((card) => card.id === clickedId);
  return index < 0 ? 0 : index;
}
