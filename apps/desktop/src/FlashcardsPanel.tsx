import { useCallback, useEffect, useState } from 'react';
import type {
  FlashcardRecord,
  HostResponse,
  ReviewQueueItem,
  ReviewRating,
} from '@piwin/contracts';

export type FlashcardsPanelProps = {
  request: (command:
    | { type: 'flashcards/list'; deck?: string }
    | { type: 'flashcards/delete'; cardId: string }
    | { type: 'flashcards/decks' }
    | { type: 'flashcards/queue'; deck?: string }
    | { type: 'flashcards/rate'; cardId: string; rating: ReviewRating }
  ) => Promise<HostResponse>;
};

/**
 * Flashcards panel (ADR 0018 S7): decks, due queue, keyboard-first review flow.
 * Space = reveal, 1–4 = rate. Review state lives in ~/.piwin/flashcards/review.
 */
export function FlashcardsPanel(props: FlashcardsPanelProps) {
  const [decks, setDecks] = useState<string[]>([]);
  const [deckFilter, setDeckFilter] = useState<string>('');
  const [cards, setCards] = useState<FlashcardRecord[]>([]);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const decksResponse = await props.request({ type: 'flashcards/decks' });
    if (decksResponse.success) {
      const decksData = decksResponse.data as { decks: string[] };
      setDecks(decksData.decks ?? []);
    }
    const listResponse = await props.request({
      type: 'flashcards/list',
      ...(deckFilter ? { deck: deckFilter } : {}),
    });
    if (!listResponse.success) {
      setError(listResponse.error);
      setLoading(false);
      return;
    }
    const listData = listResponse.data as { cards: FlashcardRecord[] };
    setCards(listData.cards ?? []);

    const queueResponse = await props.request({
      type: 'flashcards/queue',
      ...(deckFilter ? { deck: deckFilter } : {}),
    });
    if (queueResponse.success) {
      const queueData = queueResponse.data as { queue: ReviewQueueItem[] };
      setQueue(queueData.queue ?? []);
    }
    setLoading(false);
  }, [props, deckFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentItem = reviewing ? queue[position] : undefined;

  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      if (!currentItem) return;
      const response = await props.request({
        type: 'flashcards/rate',
        cardId: currentItem.card.id,
        rating,
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      if (position + 1 >= queue.length) {
        setReviewing(false);
        setInfo(`Review done — ${queue.length} card(s)`);
        await loadData();
      } else {
        setPosition(position + 1);
        setRevealed(false);
      }
    },
    [currentItem, loadData, position, props, queue.length],
  );

  // Keyboard-first review: Space reveal, 1-4 rate, Escape quit.
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === ' ' && !revealed) {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (event.key === 'Escape') {
        setReviewing(false);
        return;
      }
      if (revealed) {
        const rating =
          event.key === '1'
            ? 'again'
            : event.key === '2'
              ? 'hard'
              : event.key === '3'
                ? 'good'
                : event.key === '4'
                  ? 'easy'
                  : null;
        if (rating) {
          event.preventDefault();
          void handleRate(rating);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewing, revealed, handleRate]);

  async function handleDelete(cardId: string): Promise<void> {
    setError(null);
    const response = await props.request({ type: 'flashcards/delete', cardId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo('Card deleted');
    await loadData();
  }

  return (
    <div className="settings-section" data-testid="flashcards-panel">
      <div className="settings-card-heading">
        <div>
          <h4>Flashcards</h4>
          <p>FSRS spaced repetition under ~/.piwin/flashcards. Generate cards via chat.</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}
      {info ? <p className="muted">{info}</p> : null}

      {reviewing && currentItem ? (
        <div className="settings-card" data-testid="flashcards-review" style={{ marginTop: 10 }}>
          <p className="muted">
            [{position + 1}/{queue.length}] {currentItem.isNew ? '(new) ' : ''}
            {currentItem.card.deck} · Space=reveal · 1-4=rate · Esc=quit
          </p>
          <div style={{ fontSize: 17, margin: '12px 0' }} data-testid="flashcards-review-front">
            {currentItem.card.front}
          </div>
          {revealed ? (
            <>
              <div
                style={{ borderTop: '1px dashed var(--border, #444)', paddingTop: 12 }}
                data-testid="flashcards-review-back"
              >
                {currentItem.card.back}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn" onClick={() => void handleRate('again')}>
                  1 忘了
                </button>
                <button type="button" className="btn" onClick={() => void handleRate('hard')}>
                  2 较难
                </button>
                <button type="button" className="btn" onClick={() => void handleRate('good')}>
                  3 记住了
                </button>
                <button type="button" className="btn" onClick={() => void handleRate('easy')}>
                  4 简单
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="btn primary"
              data-testid="flashcards-reveal"
              onClick={() => setRevealed(true)}
            >
              Reveal answer
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <select
              value={deckFilter}
              onChange={(event) => setDeckFilter(event.target.value)}
              data-testid="flashcards-deck-filter"
            >
              <option value="">All decks</option>
              {decks.map((deck) => (
                <option key={deck} value={deck}>
                  {deck}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn primary"
              data-testid="flashcards-start-review"
              disabled={queue.length === 0}
              onClick={() => {
                setPosition(0);
                setRevealed(false);
                setReviewing(true);
                setInfo(null);
              }}
            >
              Review {queue.length} due
            </button>
            <button type="button" className="btn" onClick={() => void loadData()}>
              Refresh
            </button>
          </div>

          {loading ? (
            <p className="muted">Loading…</p>
          ) : cards.length === 0 ? (
            <p className="muted">
              No cards yet. Ask the agent to generate flashcards from a note (flashcard_create).
            </p>
          ) : (
            <ul className="provider-list" data-testid="flashcards-list" style={{ marginTop: 10 }}>
              {cards.map((card) => (
                <li key={card.id}>
                  <strong>{card.front.slice(0, 80)}</strong>
                  <span className="muted"> · {card.deck}</span>
                  {card.sourceNoteId ? (
                    <span className="muted"> · from {card.sourceNoteId.slice(0, 16)}…</span>
                  ) : null}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void handleDelete(card.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
