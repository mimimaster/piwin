import { useState, useEffect, useRef, type ReactElement, type KeyboardEvent, type MouseEvent } from 'react';
import type { FlashcardReviewCard } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import { flashcardChatCopy, flashcardRateLabel } from './flashcard-chat-copy';
import { FlashcardChatFaces } from './flashcard-chat-faces';
import type { FlashcardRateName } from './flashcard-rate-bar';

export type FlashcardViewProps = {
  card: FlashcardReviewCard;
  onAction?: (action: ArtifactActionMessage) => void;
  locale?: 'zh-CN' | 'en' | undefined;
  cardIndex?: number | undefined;
  totalCards?: number | undefined;
};

export function FlashcardView({
  card,
  onAction,
  locale = 'zh-CN',
  cardIndex,
  totalCards,
}: FlashcardViewProps): ReactElement {
  const [flipped, setFlipped] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [rated, setRated] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const flipTimerRef = useRef<number | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const frontBodyRef = useRef<HTMLDivElement>(null);
  const backBodyRef = useRef<HTMLDivElement>(null);
  const chatCopy = flashcardChatCopy(locale);

  useEffect(() => {
    return () => {
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
        flipTimerRef.current = null;
      }
    };
  }, []);

  const hasSource = Boolean(card.sourceFolder || card.sourceNoteId);
  const sourcePath = card.sourceFile
    ? `${card.sourceFile}${card.sourceLine && card.sourceLine > 0 ? `:${card.sourceLine}` : ''}`
    : card.sourceNoteId
      ? `note:${card.sourceNoteId}`
      : '';

  const handleToggleFlip = (): void => {
    if (flipTimerRef.current !== null) {
      window.clearTimeout(flipTimerRef.current);
    }
    setIsFlipping(true);
    setFlipped((prev) => !prev);
    flipTimerRef.current = window.setTimeout(() => {
      setIsFlipping(false);
      flipTimerRef.current = null;
    }, 550);
  };

  const handleRate = (rating: FlashcardRateName): void => {
    const label = flashcardRateLabel(chatCopy, rating);
    setRated(label);
    if (onAction) {
      onAction({
        type: 'piwin-artifact:action',
        channelId: card.cardId,
        action: 'flashcard/rate',
        payload: {
          cardId: card.cardId,
          rating,
        },
      });
    }
  };

  const handleOpenSource = (event: MouseEvent): void => {
    event.stopPropagation();
    if (onAction) {
      onAction({
        type: 'piwin-artifact:action',
        channelId: card.cardId,
        action: 'flashcard/open-source',
        payload: {
          cardId: card.cardId,
          openFile: true,
        },
      });
    }
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target !== event.currentTarget &&
      target.closest('button, textarea, input, [contenteditable="true"]')
    ) {
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      handleToggleFlip();
    } else if (flipped && rated === null && card.ordinal > 0) {
      if (event.key === '1') {
        event.preventDefault();
        handleRate('again');
      } else if (event.key === '2') {
        event.preventDefault();
        handleRate('hard');
      } else if (event.key === '3') {
        event.preventDefault();
        handleRate('good');
      } else if (event.key === '4') {
        event.preventDefault();
        handleRate('easy');
      }
    }
  };

  return (
    <div
      ref={cardRef}
      className="fc-quiet-card-container"
      data-card-id={card.cardId}
      data-testid="chat-flashcard"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <FlashcardChatFaces
        card={card}
        copy={chatCopy}
        locale={locale}
        flipped={flipped}
        isFlipping={isFlipping}
        cardIndex={cardIndex}
        totalCards={totalCards}
        frontBodyRef={frontBodyRef}
        backBodyRef={backBodyRef}
        sourcePath={sourcePath}
        hasSource={hasSource}
        rated={rated}
        onRate={handleRate}
        onChangeRated={() => setRated(null)}
        onToggleSource={() => setSourceOpen((prev) => !prev)}
      />

      <div className="fc-quiet-controls">
        <button
          type="button"
          className="fc-quiet-control-btn"
          data-testid="chat-flashcard-flip"
          onClick={handleToggleFlip}
        >
          {flipped ? chatCopy.flipBack : chatCopy.flipToAnswer}
        </button>
      </div>

      {sourceOpen && hasSource ? (
        <div className="fc-quiet-source-popover">
          <div className="fc-quiet-popover-header">
            <span className="fc-quiet-popover-path">{sourcePath}</span>
            {card.sourceFile ? (
              <button type="button" className="fc-quiet-open-btn" onClick={handleOpenSource}>
                {chatCopy.openSource}
              </button>
            ) : null}
          </div>
          {card.sourceExcerpt ? (
            <div className="fc-quiet-popover-excerpt">{card.sourceExcerpt}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
