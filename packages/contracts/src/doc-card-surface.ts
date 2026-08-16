import type { FlashcardRecord } from './flashcards.js';

/** Fixed visual slots for one Doc Card. Skin may change; these fields may not. */
export type DocCardSurfaceCard = {
  id: string;
  workspaceName: string;
  position: number;
  total: number;
  front: string;
  back: string;
  sourceLabel?: string;
  canOpenSource: boolean;
};

export type DocCardSurfaceModel = {
  workspaceName: string;
  cards: DocCardSurfaceCard[];
};

export function buildDocCardSurface(input: {
  workspaceName: string;
  cards: FlashcardRecord[];
}): DocCardSurfaceModel {
  const cards: DocCardSurfaceCard[] = [];
  for (const card of input.cards) {
    if (!card.front.trim()) continue;
    const sourceLabel = formatSourceLabel(card);
    cards.push({
      id: card.id,
      workspaceName: input.workspaceName,
      position: cards.length + 1,
      total: 0,
      front: card.front,
      back: card.back,
      ...(sourceLabel ? { sourceLabel } : {}),
      canOpenSource: Boolean(card.sourceFolder && card.sourceFile),
    });
  }
  return {
    workspaceName: input.workspaceName,
    cards: cards.map((card) => ({ ...card, total: cards.length })),
  };
}

function formatSourceLabel(card: FlashcardRecord): string | undefined {
  if (!card.sourceFile) return undefined;
  return typeof card.sourceLine === 'number' ? `${card.sourceFile}:${card.sourceLine}` : card.sourceFile;
}
