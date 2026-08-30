import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlashcardCreateInput, FlashcardItem, HostResponse } from '@piwin/contracts';

export type FlashcardsLibraryCommand =
  | { type: 'flashcards/decks' }
  | { type: 'flashcards/list' }
  | { type: 'flashcards/delete'; cardId: string }
  | { type: 'flashcards/create'; input: FlashcardCreateInput };

export type FlashcardsRequester = (command: FlashcardsLibraryCommand) => Promise<HostResponse>;

export type FlashcardsWorkspace = {
  decks: string[];
  cards: FlashcardItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  remove: (cardId: string) => Promise<boolean>;
  removeMany: (cardIds: string[]) => Promise<boolean>;
  create: (input: FlashcardCreateInput) => Promise<boolean>;
};

export function useFlashcardsWorkspace(request: FlashcardsRequester): FlashcardsWorkspace {
  const [decks, setDecks] = useState<string[]>([]);
  const [cards, setCards] = useState<FlashcardItem[]>([]);
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
      setCards((listResponse.data as { cards?: FlashcardItem[] }).cards ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(async (cardId: string) => {
    const response = await requestRef.current({ type: 'flashcards/delete', cardId });
    return response.success;
  }, []);

  const removeMany = useCallback(async (cardIds: string[]) => {
    for (const cardId of cardIds) {
      const ok = await remove(cardId);
      if (!ok) return false;
    }
    return true;
  }, [remove]);

  const create = useCallback(async (input: FlashcardCreateInput) => {
    const response = await requestRef.current({ type: 'flashcards/create', input });
    return response.success;
  }, []);

  return { decks, cards, loading, error, reload, remove, removeMany, create };
}

/** @deprecated Use FlashcardsLibraryCommand. */
export type FlashcardsWorkspaceCommand = FlashcardsLibraryCommand;
