import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FlashcardCreateInput,
  FlashcardItem,
  HostResponse,
  ReviewQueueItem,
  ReviewRating,
} from '@piwin/contracts';

export type FlashcardsWorkspaceCommand =
  | { type: 'flashcards/decks' }
  | { type: 'flashcards/list' }
  | { type: 'flashcards/queue'; deck?: string }
  | { type: 'flashcards/rate'; cardId: string; rating: ReviewRating }
  | { type: 'flashcards/delete'; cardId: string }
  | { type: 'flashcards/create'; input: FlashcardCreateInput };

export type FlashcardsRequester = (command: FlashcardsWorkspaceCommand) => Promise<HostResponse>;

type FlashcardLibrary = {
  decks: string[];
  cards: FlashcardItem[];
  queue: ReviewQueueItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/**
 * Loads the flashcard library from the Host (ADR 0018 commands): decks, all
 * cards (filtered client-side so deck counts stay correct), and the FSRS due
 * queue for the selected deck.
 */
function useFlashcardLibrary(request: FlashcardsRequester): FlashcardLibrary {
  const [decks, setDecks] = useState<string[]>([]);
  const [cards, setCards] = useState<FlashcardItem[]>([]);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    const requester = requestRef.current;
    try {
      const decksResponse = await requester({ type: 'flashcards/decks' });
      if (!decksResponse.success) {
        setError(decksResponse.error);
        return;
      }
      setDecks((decksResponse.data as { decks: string[] }).decks ?? []);

      const listResponse = await requester({ type: 'flashcards/list' });
      if (!listResponse.success) {
        setError(listResponse.error);
        return;
      }
      const listData = (listResponse.data as { cards?: FlashcardItem[] }).cards ?? [];
      setCards(listData);

      // Queue is fetched unfiltered; the workspace filters it client-side so
      // per-deck due badges stay correct without extra round trips.
      const queueResponse = await requester({ type: 'flashcards/queue' });
      if (!queueResponse.success) {
        setError(queueResponse.error);
        return;
      }
      setQueue((queueResponse.data as { queue?: ReviewQueueItem[] }).queue ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { decks, cards, queue, loading, error, reload };
}

/** Mutating actions over the flashcard library; each reloads on success. */
function useFlashcardMutations(request: FlashcardsRequester): {
  rate: (cardId: string, rating: ReviewRating) => Promise<boolean>;
  remove: (cardId: string) => Promise<boolean>;
  create: (input: FlashcardCreateInput) => Promise<boolean>;
} {
  const requestRef = useRef(request);
  requestRef.current = request;

  const run = useCallback(async (command: FlashcardsWorkspaceCommand): Promise<boolean> => {
    const response = await requestRef.current(command);
    return response.success;
  }, []);

  return useMemo(
    () => ({
      rate: (cardId, rating) => run({ type: 'flashcards/rate', cardId, rating }),
      remove: (cardId) => run({ type: 'flashcards/delete', cardId }),
      create: (input) => run({ type: 'flashcards/create', input }),
    }),
    [run],
  );
}

/** Composed library + mutations hook for the flashcards workspace page. */
export type FlashcardsWorkspace = {
  decks: string[];
  cards: FlashcardItem[];
  queue: ReviewQueueItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  rate: (cardId: string, rating: ReviewRating) => Promise<boolean>;
  remove: (cardId: string) => Promise<boolean>;
  create: (input: FlashcardCreateInput) => Promise<boolean>;
};

export function useFlashcardsWorkspace(request: FlashcardsRequester): FlashcardsWorkspace {
  const library = useFlashcardLibrary(request);
  const actions = useFlashcardMutations(request);
  return {
    decks: library.decks,
    cards: library.cards,
    queue: library.queue,
    loading: library.loading,
    error: library.error,
    reload: library.reload,
    rate: actions.rate,
    remove: actions.remove,
    create: actions.create,
  };
}
