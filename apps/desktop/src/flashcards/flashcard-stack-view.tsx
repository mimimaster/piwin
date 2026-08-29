import { useCallback, useState, type ReactElement } from 'react';
import type { FlashcardReviewCard } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import { collapseToPhysicalCards } from '@piwin/flashcards/cloze';
import { FlashcardView } from './flashcard-chat-view';
import { flashcardChatCopy } from './flashcard-chat-copy';

export function FlashcardStackView(props: {
  cards: FlashcardReviewCard[];
  onAction?: (action: ArtifactActionMessage) => void;
  locale?: 'zh-CN' | 'en' | undefined;
}): ReactElement {
  const cards = collapseToPhysicalCards(props.cards);
  const { onAction, locale = 'zh-CN' } = props;
  const copy = flashcardChatCopy(locale);
  const [activeIndex, setActiveIndex] = useState(0);

  const safeIndex = Math.min(Math.max(0, activeIndex), Math.max(0, cards.length - 1));
  const activeCard = cards[safeIndex];

  const handlePrev = useCallback((): void => {
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : cards.length - 1));
  }, [cards.length]);

  const handleNext = useCallback((): void => {
    setActiveIndex((prev) => (prev < cards.length - 1 ? prev + 1 : 0));
  }, [cards.length]);

  if (!cards || cards.length === 0 || !activeCard) {
    return <div className="fc-quiet-empty" />;
  }

  if (cards.length === 1) {
    return (
      <div className="fc-quiet-stack">
        <FlashcardView card={activeCard} {...(onAction ? { onAction } : {})} locale={locale} />
      </div>
    );
  }

  return (
    <div className="fc-quiet-stack is-multi">
      <div className="fc-quiet-nav">
        <span className="fc-quiet-nav-label">{copy.cardsCount(cards.length)}</span>
        <div className="fc-quiet-nav-actions">
          <button
            type="button"
            className="fc-quiet-nav-btn"
            onClick={handlePrev}
            aria-label={copy.previous}
            title={copy.previous}
          >
            ‹
          </button>
          <span className="fc-quiet-nav-count">
            {safeIndex + 1} / {cards.length}
          </span>
          <button
            type="button"
            className="fc-quiet-nav-btn"
            onClick={handleNext}
            aria-label={copy.next}
            title={copy.next}
          >
            ›
          </button>
        </div>
      </div>

      <div className="fc-quiet-stage">
        <FlashcardView
          key={activeCard.cardId}
          card={activeCard}
          cardIndex={safeIndex}
          totalCards={cards.length}
          {...(onAction ? { onAction } : {})}
          locale={locale}
        />
      </div>
    </div>
  );
}
