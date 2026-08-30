import { useState, useEffect, useRef, useCallback, type ReactElement, type KeyboardEvent, type MouseEvent } from 'react';
import type { FlashcardReviewCard, FlashcardTutorFace } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import { CardSelectionPopover } from './card-selection-popover';
import type { CardTutorInvokeSource } from './card-selection-keys';
import { CardTutorPanel } from './card-tutor-panel';
import { cardTutorCopy, fallbackActionLabel } from './card-tutor-copy';
import { clipSelectionText } from './card-text-selection';
import { useCardTutor } from './card-tutor-provider';
import { useCardTextSelection } from './use-card-text-selection';
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
  const face: FlashcardTutorFace = flipped ? 'back' : 'front';
  const activeBodyRef = flipped ? backBodyRef : frontBodyRef;
  const selection = useCardTextSelection({ containerRef: activeBodyRef });
  const tutor = useCardTutor();
  const copy = cardTutorCopy(locale);
  const chatCopy = flashcardChatCopy(locale);
  const [focusHeading, setFocusHeading] = useState(false);
  const cancelForItem = tutor.cancelForItem;

  useEffect(() => {
    return () => {
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
        flipTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const itemId = card.itemId;
    return () => {
      cancelForItem(itemId);
    };
  }, [card.itemId, cancelForItem]);

  const hasSource = Boolean(card.sourceFolder || card.sourceNoteId);
  const sourcePath = card.sourceFile
    ? `${card.sourceFile}${card.sourceLine && card.sourceLine > 0 ? `:${card.sourceLine}` : ''}`
    : card.sourceNoteId
      ? `note:${card.sourceNoteId}`
      : '';

  const restoreCardFocus = useCallback((): void => {
    cardRef.current?.focus();
  }, []);

  const handleToggleFlip = (): void => {
    selection.dismiss();
    if (tutor.state.itemId === card.itemId) {
      tutor.cancel();
    }
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

  const invokeSelection = (source: CardTutorInvokeSource = 'pointer'): void => {
    const snap = selection.snapshot;
    if (!snap) return;
    setFocusHeading(source === 'keyboard');
    void tutor.explain({
      itemId: card.itemId,
      face,
      selectedText: snap.selectedText,
      intent: face === 'front' ? 'hint' : 'explain',
    });
    selection.dismiss();
  };

  const invokeFallback = (): void => {
    const faceText = face === 'front' ? card.front : card.back;
    const selectedText = clipSelectionText(faceText);
    if (!selectedText) return;
    void tutor.explain({
      itemId: card.itemId,
      face,
      selectedText,
      intent: face === 'front' ? 'hint' : 'explain',
    });
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
    if (selection.snapshot && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      invokeSelection('keyboard');
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

      <CardSelectionPopover
        open={selection.snapshot !== null}
        locale={locale}
        face={face}
        getAnchorRect={selection.getAnchorRect}
        onInvoke={invokeSelection}
        onDismiss={selection.dismiss}
        restoreFocus={restoreCardFocus}
        scopeRef={cardRef}
      />

      <CardTutorPanel
        locale={locale}
        itemId={card.itemId}
        face={face}
        item={card}
        autoFocusHeading={focusHeading}
      />

      <div className="fc-quiet-controls">
        <button
          type="button"
          className="fc-quiet-control-btn"
          data-testid="chat-flashcard-flip"
          onClick={handleToggleFlip}
        >
          {flipped ? copy.flipQuestion : copy.flipAnswer}
        </button>
        <button
          type="button"
          className="fc-quiet-control-btn"
          data-testid="card-tutor-fallback"
          onClick={invokeFallback}
        >
          {fallbackActionLabel(locale, face)}
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
