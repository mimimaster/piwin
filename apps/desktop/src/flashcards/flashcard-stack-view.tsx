import { useCallback, useState, type ReactElement } from 'react';
import type { FlashcardReviewCard } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import { collapseToPhysicalCards } from '@piwin/flashcards/cloze';
import { IconCards } from '../shell-icons';
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
  const deckName = activeCard?.deck || copy.unnamedDeck;

  const handleNextAfterRate = useCallback((): void => {
    if (cards.length <= 1) return;
    setActiveIndex((prev) => (prev < cards.length - 1 ? prev + 1 : 0));
  }, [cards.length]);

  if (!cards || cards.length === 0 || !activeCard) {
    return <div className="fc-empty" />;
  }

  return (
    <div className={`fc-stack${cards.length > 1 ? ' is-multi' : ''}`}>
      <div className="fc-h">
        <IconCards width={14} height={14} aria-hidden="true" className="i" />
        <b>{copy.generatedCards(cards.length)}</b>
        <span>{copy.deckSep(deckName)}</span>
        {cards.length > 1 ? (
          <span className="ml">
            {safeIndex + 1} / {cards.length}
          </span>
        ) : null}
      </div>

      <FlashcardView
        key={activeCard.cardId}
        card={activeCard}
        cardIndex={safeIndex}
        totalCards={cards.length}
        {...(onAction ? { onAction } : {})}
        onRated={handleNextAfterRate}
        locale={locale}
      />
    </div>
  );
}
