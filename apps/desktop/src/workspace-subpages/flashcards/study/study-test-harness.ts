import type {
  FlashcardStudyContentProjection,
  FlashcardStudyMode,
  FlashcardStudyScope,
  FlashcardStudySnapshot,
  HostCommand,
  HostResponse,
} from '@piwin/contracts';

export type StudyHarnessCard = {
  id: string;
  front?: string;
  back?: string;
  deck?: string;
  sequenceId?: string;
  sourceFile?: string;
  sourceTitle?: string;
};

type RoundState = {
  roundId: string;
  mode: FlashcardStudyMode;
  scope: FlashcardStudyScope;
  status: 'active' | 'paused' | 'completed' | 'ended';
  revision: number;
  controlEpoch: number;
  index: number;
  face: 'question' | 'answer';
  cards: StudyHarnessCard[];
  processed: number;
  lastAdvance: string | null;
  needsReview: Set<string>;
  history: Array<{ index: number; processed: number; face: 'question' | 'answer' }>;
};

export function createStudyHostFake(cards: StudyHarnessCard[]): {
  request: (command: HostCommand) => Promise<HostResponse>;
  calls: HostCommand[];
} {
  const calls: HostCommand[] = [];
  const rounds = new Map<string, RoundState>();
  let roundSeq = 1;

  function cardsForScope(scope: FlashcardStudyScope): StudyHarnessCard[] {
    if (scope.kind === 'item') return cards.filter((card) => card.id === scope.itemId);
    if (scope.kind === 'sequence') {
      return cards.filter((card) => card.sequenceId === scope.sequenceId);
    }
    if (scope.kind === 'selection') {
      return cards.filter((card) => scope.itemIds.includes(card.id));
    }
    if (scope.kind === 'deck') return cards.filter((card) => (card.deck ?? 'General') === scope.deck);
    return cards;
  }

  function snapshotOf(round: RoundState): FlashcardStudySnapshot {
    const currentCard = round.cards[round.index];
    const total = round.cards.length;
    const remaining = Math.max(0, total - round.processed);
    const current: FlashcardStudyContentProjection | undefined = currentCard
      ? {
          entryId: `entry-${currentCard.id}`,
          itemId: currentCard.id,
          contentVersion: 'cv-1',
          model: 'basic',
          deck: currentCard.deck ?? 'General',
          face: round.face,
          front: currentCard.front ?? '',
          back: currentCard.back ?? '',
          needsReview: round.needsReview.has(currentCard.id),
          ...(currentCard.sourceTitle
            ? { sourceTitle: currentCard.sourceTitle }
            : currentCard.sourceFile
              ? { sourceTitle: sourceTitleFromFile(currentCard.sourceFile) }
              : {}),
        }
      : undefined;
    const nextCard = round.cards[round.index + 1];
    const snapshot: FlashcardStudySnapshot = {
      round: {
        roundId: round.roundId,
        schemaVersion: 1,
        mode: round.mode,
        scope: round.scope,
        status: round.status,
        revision: round.revision,
        controlEpoch: round.controlEpoch,
        controllerIdentity: 'desktop',
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T00:00:00.000Z',
        currentEntryId: current ? `entry-${current.itemId}` : null,
        face: round.face,
        lastAdvanceOperationId: round.lastAdvance,
      },
      counts: {
        total,
        processed: round.processed,
        invalidated: 0,
        remaining,
      },
      canUndo: round.lastAdvance !== null,
      access: { hasControl: true, controllerIdentity: 'desktop', controlEpoch: round.controlEpoch },
    };
    if (current) snapshot.current = current;
    if (nextCard && round.status === 'active') {
      snapshot.nextShell = {
        entryId: `entry-${nextCard.id}`,
        itemId: nextCard.id,
        contentVersion: 'cv-1',
      };
    }
    return snapshot;
  }

  function requireRound(roundId: string): RoundState {
    const round = rounds.get(roundId);
    if (!round) throw new Error(`missing round ${roundId}`);
    return round;
  }

  function ok(command: HostCommand, data: unknown): HostResponse {
    return { type: 'response', command: command.type, success: true, data };
  }

  return {
    calls,
    request: async (command) => {
      calls.push(command);
      switch (command.type) {
        case 'flashcards/study/catalog':
          return ok(command, {
            tiles: [],
            dueCount: cards.length,
            newCount: 1,
            unfinishedRounds: [],
          });
        case 'flashcards/study/start': {
          const scoped = cardsForScope(command.scope);
          const existing =
            command.resumeExisting !== false
              ? [...rounds.values()]
                  .filter(
                    (round) =>
                      round.mode === command.mode &&
                      JSON.stringify(round.scope) === JSON.stringify(command.scope) &&
                      (round.status === 'active' || round.status === 'paused'),
                  )
                  .at(-1)
              : undefined;
          if (existing) return ok(command, snapshotOf(existing));
          const round: RoundState = {
            roundId: `round-${roundSeq}`,
            mode: command.mode,
            scope: command.scope,
            status: scoped.length === 0 ? 'completed' : 'active',
            revision: 0,
            controlEpoch: 1,
            index: 0,
            face: 'question',
            cards: scoped,
            processed: 0,
            lastAdvance: null,
            needsReview: new Set(),
            history: [],
          };
          roundSeq += 1;
          rounds.set(round.roundId, round);
          return ok(command, snapshotOf(round));
        }
        case 'flashcards/study/get':
          return ok(command, snapshotOf(requireRound(command.roundId)));
        case 'flashcards/study/checkpoint': {
          const round = requireRound(command.roundId);
          round.face = command.face;
          if (command.needsReview !== undefined) {
            const card = round.cards[round.index];
            if (card) {
              if (command.needsReview) round.needsReview.add(card.id);
              else round.needsReview.delete(card.id);
            }
          }
          round.revision += 1;
          return ok(command, snapshotOf(round));
        }
        case 'flashcards/study/next':
        case 'flashcards/study/rate': {
          const round = requireRound(command.roundId);
          round.history.push({ index: round.index, processed: round.processed, face: round.face });
          round.processed += 1;
          round.lastAdvance = command.type === 'flashcards/study/rate' ? 'rate-1' : 'next-1';
          if (round.index < round.cards.length - 1) {
            round.index += 1;
            round.face = 'question';
          } else {
            round.status = 'completed';
          }
          round.revision += 1;
          return ok(command, snapshotOf(round));
        }
        case 'flashcards/study/undo': {
          const round = requireRound(command.roundId);
          const previous = round.history.pop();
          if (previous) {
            round.index = previous.index;
            round.processed = previous.processed;
            round.face = previous.face;
            round.status = 'active';
            round.lastAdvance = round.history.length > 0 ? 'next-1' : null;
          }
          round.revision += 1;
          return ok(command, snapshotOf(round));
        }
        case 'flashcards/study/pause': {
          const round = requireRound(command.roundId);
          round.status = 'paused';
          round.revision += 1;
          return ok(command, snapshotOf(round));
        }
        case 'flashcards/study/resume': {
          const round = requireRound(command.roundId);
          round.status = 'active';
          round.revision += 1;
          return ok(command, snapshotOf(round));
        }
        case 'flashcards/study/end': {
          const round = requireRound(command.roundId);
          round.status = 'ended';
          round.revision += 1;
          return ok(command, snapshotOf(round));
        }
        case 'flashcards/study/operation':
          return ok(command, { status: 'not-found' });
        default:
          return { type: 'response', command: command.type, success: false, error: 'unexpected' };
      }
    },
  };
}

function sourceTitleFromFile(sourceFile: string): string {
  const parts = sourceFile.split(/[/\\]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? sourceFile;
}
