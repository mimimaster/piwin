import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@piwin/ui-kit';
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
    | { type: 'flashcards/export'; deck?: string }
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
  const reviewingRef = useRef(false);
  const ratingInFlightRef = useRef(false);

  useEffect(() => {
    reviewingRef.current = reviewing;
  }, [reviewing]);

  const request = props.request;
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const decksResponse = await request({ type: 'flashcards/decks' });
    if (decksResponse.success) {
      const decksData = decksResponse.data as { decks: string[] };
      setDecks(decksData.decks ?? []);
    }
    const listResponse = await request({
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

    const queueResponse = await request({
      type: 'flashcards/queue',
      ...(deckFilter ? { deck: deckFilter } : {}),
    });
    if (queueResponse.success) {
      const queueData = queueResponse.data as { queue: ReviewQueueItem[] };
      // Never replace the queue mid-review: rated cards drop out of the
      // rebuilt queue and queue[position] would skip/repeat cards.
      setQueue((previous) => (reviewingRef.current ? previous : queueData.queue ?? []));
    }
    setLoading(false);
  }, [request, deckFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentItem = reviewing ? queue[position] : undefined;

  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      // In-flight guard: rapid double keypress must not rate the same card twice.
      if (!currentItem || ratingInFlightRef.current) return;
      ratingInFlightRef.current = true;
      try {
        const response = await request({
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
      } finally {
        ratingInFlightRef.current = false;
      }
    },
    [currentItem, loadData, position, request, queue.length],
  );

  // Keyboard-first review: Space reveal, 1-4 rate, Escape quit.
  useEffect(() => {
    if (!reviewing) return;
    const onKey = (event: KeyboardEvent) => {
      // Ignore keys while the user is typing elsewhere (chat composer, inputs) —
      // otherwise "3" in the composer would silently rate the current card.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
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

  async function handleExport(): Promise<void> {
    setError(null);
    const response = await props.request({
      type: 'flashcards/export',
      ...(deckFilter ? { deck: deckFilter } : {}),
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { tsv: string; count: number };
    // Download as a file (Anki: File → Import, tab separator).
    const blob = new Blob([data.tsv], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = deckFilter ? `piwin-cards-${deckFilter}.tsv` : 'piwin-cards.tsv';
    anchor.click();
    URL.revokeObjectURL(url);
    setInfo(`Exported ${data.count} card(s) as Anki TSV`);
  }

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
                <Button onClick={() => void handleRate('again')}>1 忘了</Button>
                <Button onClick={() => void handleRate('hard')}>2 较难</Button>
                <Button onClick={() => void handleRate('good')}>3 记住了</Button>
                <Button onClick={() => void handleRate('easy')}>4 简单</Button>
              </div>
            </>
          ) : (
            <Button
              variant="primary"
              data-testid="flashcards-reveal"
              onClick={() => setRevealed(true)}
            >
              Reveal answer
            </Button>
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
            <Button
              variant="primary"
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
            </Button>
            <Button onClick={() => void loadData()}>Refresh</Button>
            <Button
              data-testid="flashcards-export"
              disabled={cards.length === 0}
              onClick={() => void handleExport()}
              title="Export as Anki-importable TSV"
            >
              Export TSV
            </Button>
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
                    <Button onClick={() => void handleDelete(card.id)}>Delete</Button>
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
