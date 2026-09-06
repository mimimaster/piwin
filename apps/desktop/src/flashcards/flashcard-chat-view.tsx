import {
  useState,
  useEffect,
  useRef,
  type ReactElement,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { FlashcardReviewCard } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import { flashcardChatCopy, flashcardRateLabel } from './flashcard-chat-copy';
import { FlashcardChatFaces } from './flashcard-chat-faces';
import { FlashcardRateBar, type FlashcardRateName } from './flashcard-rate-bar';

export type FlashcardViewProps = {
  card: FlashcardReviewCard;
  onAction?: (action: ArtifactActionMessage) => void;
  /** Called after a successful rate so stacks can advance. */
  onRated?: () => void;
  locale?: 'zh-CN' | 'en' | undefined;
  cardIndex?: number | undefined;
  totalCards?: number | undefined;
};

const FLIP_MS = 400;

export function FlashcardView({
  card,
  onAction,
  onRated,
  locale = 'zh-CN',
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

  useEffect(() => {
    setFlipped(false);
    setIsFlipping(false);
    setRated(null);
    setSourceOpen(false);
  }, [card.cardId]);

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
    }, FLIP_MS);
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
    onRated?.();
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
    } else if (rated === null && card.ordinal > 0) {
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
      className="fc-card"
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
        frontBodyRef={frontBodyRef}
        backBodyRef={backBodyRef}
        sourcePath={sourcePath}
        hasSource={hasSource}
        onToggleFlip={handleToggleFlip}
        onToggleSource={() => setSourceOpen((prev) => !prev)}
      />

      {card.ordinal > 0 ? (
        <FlashcardRateBar
          copy={chatCopy}
          rated={rated}
          onRate={handleRate}
          onChange={() => setRated(null)}
        />
      ) : null}

      {sourceOpen && hasSource ? (
        <div className="fc-source-popover">
          <div className="fc-source-popover-header">
            <span className="fc-source-popover-path">{sourcePath}</span>
            {card.sourceFile ? (
              <button type="button" className="btn sm" onClick={handleOpenSource}>
                {chatCopy.openSource}
              </button>
            ) : null}
          </div>
          {card.sourceExcerpt ? (
            <div className="fc-source-popover-excerpt">{card.sourceExcerpt}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
