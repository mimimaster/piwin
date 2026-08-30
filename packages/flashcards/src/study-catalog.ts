import {
  FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT,
  FLASHCARD_STUDY_CATALOG_MAX_LIMIT,
  computeFlashcardStudyCounts,
  type FlashcardItem,
  type FlashcardReviewCard,
  type FlashcardStudyCatalogPage,
  type FlashcardStudyRound,
  type FlashcardStudyScope,
  type FlashcardStudyTileSummary,
  type FlashcardStudyUnfinishedRoundSummary,
  type ReviewState,
} from '@piwin/contracts';
import { isNewState } from './scheduler.js';
import {
  groupFlashcardTiles,
  tileCards,
  tileMatchesQuery,
  tilePreview,
  type FlashcardTile,
} from './study-sequence.js';

export type BuildStudyCatalogInput = {
  items: readonly FlashcardItem[];
  reviewCards?: readonly FlashcardReviewCard[];
  states?: ReadonlyMap<string, ReviewState>;
  unfinishedRounds?: readonly FlashcardStudyRound[];
  scopeFilter?: FlashcardStudyScope;
  query?: string;
  cursor?: string;
  limit?: number;
  now?: Date;
};

export function buildStudyCatalogPage(input: BuildStudyCatalogInput): FlashcardStudyCatalogPage {
  const now = input.now ?? new Date();
  const limit = clampLimit(input.limit);
  const scopedItems = filterItemsByScope(input.items, input.scopeFilter);
  const tiles = groupFlashcardTiles(scopedItems).filter((tile) =>
    tileMatchesQuery(tile, input.query ?? ''),
  );
  const start = startIndexAfterCursor(tiles, input.cursor);
  const pageTiles = tiles.slice(start, start + limit);
  const hasMore = start + limit < tiles.length;
  const { dueCount, newCount } = countDueAndNew(
    input.reviewCards ?? [],
    input.states ?? new Map(),
    input.scopeFilter,
    now,
  );
  const page: FlashcardStudyCatalogPage = {
    tiles: pageTiles.map(toTileSummary),
    dueCount,
    newCount,
    unfinishedRounds: summarizeUnfinished(input.unfinishedRounds ?? []),
  };
  if (input.cursor) page.cursor = input.cursor;
  const last = pageTiles[pageTiles.length - 1];
  if (hasMore && last) page.nextCursor = last.id;
  return page;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit <= 0) return FLASHCARD_STUDY_CATALOG_DEFAULT_LIMIT;
  return Math.min(limit, FLASHCARD_STUDY_CATALOG_MAX_LIMIT);
}

function filterItemsByScope(
  items: readonly FlashcardItem[],
  scope: FlashcardStudyScope | undefined,
): readonly FlashcardItem[] {
  if (!scope || scope.kind === 'all') return items;
  if (scope.kind === 'deck') return items.filter((item) => item.deck === scope.deck);
  if (scope.kind === 'item') return items.filter((item) => item.id === scope.itemId);
  if (scope.kind === 'sequence') {
    return items.filter((item) => item.sequenceId === scope.sequenceId);
  }
  const selected = new Set(scope.itemIds);
  return items.filter((item) => selected.has(item.id));
}

function startIndexAfterCursor(tiles: readonly FlashcardTile[], cursor: string | undefined): number {
  if (!cursor) return 0;
  const index = tiles.findIndex((tile) => tile.id === cursor);
  return index === -1 ? 0 : index + 1;
}

function toTileSummary(tile: FlashcardTile): FlashcardStudyTileSummary {
  const cards = tileCards(tile);
  const summary: FlashcardStudyTileSummary = {
    kind: tile.kind,
    id: tile.id,
    count: cards.length,
    preview: tilePreview(tile),
  };
  if (tile.kind === 'set') summary.sequenceId = tile.sequenceId;
  const deck = cards[0]?.deck;
  if (deck) summary.deck = deck;
  return summary;
}

function countDueAndNew(
  cards: readonly FlashcardReviewCard[],
  states: ReadonlyMap<string, ReviewState>,
  scope: FlashcardStudyScope | undefined,
  now: Date,
): { dueCount: number; newCount: number } {
  let dueCount = 0;
  let newCount = 0;
  for (const card of cards) {
    if (scope?.kind === 'deck' && card.deck !== scope.deck) continue;
    const state = states.get(card.cardId);
    if (!state) continue;
    if (isNewState(state)) newCount += 1;
    else if (new Date(state.due) <= now) dueCount += 1;
  }
  return { dueCount, newCount };
}

function summarizeUnfinished(
  rounds: readonly FlashcardStudyRound[],
): FlashcardStudyUnfinishedRoundSummary[] {
  return rounds
    .filter((round) => round.status === 'active' || round.status === 'paused')
    .slice()
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((round) => ({
      roundId: round.roundId,
      mode: round.mode,
      scope: round.scope,
      status: round.status === 'paused' ? ('paused' as const) : ('active' as const),
      revision: round.revision,
      updatedAt: round.updatedAt,
      counts: computeFlashcardStudyCounts(round.entries),
    }));
}
