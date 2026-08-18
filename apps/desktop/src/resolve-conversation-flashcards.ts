import type { FlashcardItem, FlashcardReviewCard } from '@piwin/contracts';
import { collapseToPhysicalCards, itemToDisplayCard } from '@piwin/flashcards/cloze';

const CARD_ID_RE = /card-[a-zA-Z0-9-]+/g;

export function extractFlashcardItemIdsFromText(text: string): string[] {
  return [...new Set(text.match(CARD_ID_RE) ?? [])];
}

export function reviewCardsForItemIds(
  items: readonly FlashcardItem[],
  itemIds: readonly string[],
): FlashcardReviewCard[] {
  const wanted = new Set(itemIds);
  const cards: FlashcardReviewCard[] = [];
  for (const item of items) {
    if (!wanted.has(item.id)) continue;
    const display = itemToDisplayCard(item);
    if (display) cards.push(display);
  }
  return collapseToPhysicalCards(cards);
}
