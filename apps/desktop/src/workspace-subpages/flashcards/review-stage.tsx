import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { ReviewQueueItem } from '@piwin/contracts';
import { CardSelectionPopover } from '../../flashcards/card-selection-popover';
import type { CardTutorInvokeSource } from '../../flashcards/card-selection-keys';
import { CardTutorPanel } from '../../flashcards/card-tutor-panel';
import { cardTutorCopy, fallbackActionLabel } from '../../flashcards/card-tutor-copy';
import { clipSelectionText } from '../../flashcards/card-text-selection';
import { useCardTutor } from '../../flashcards/card-tutor-provider';
import { useCardTextSelection } from '../../flashcards/use-card-text-selection';
import { IconCards, IconClose } from '../../shell-icons';

export type ReviewRatingName = 'again' | 'hard' | 'good' | 'easy';

const RATING_ORDER: readonly ReviewRatingName[] = ['again', 'hard', 'good', 'easy'];

/**
 * The immersive flip-card review stage: progress header, one card, and either
 * the reveal button or the four FSRS rating buttons. Selection tutor is the
 * same contract as chat FlashcardView / TearDeck.
 */
export function ReviewStage(props: {
  item: ReviewQueueItem;
  position: number;
  total: number;
  revealed: boolean;
  isNew: boolean;
  locale?: 'zh-CN' | 'en';
  labels: {
    flipHint: string;
    rateHint: string;
    revealAnswer: string;
    exitReview: string;
    answer: string;
    newBadge: string;
    rateLabels: Record<ReviewRatingName, string>;
  };
  onToggleReveal: () => void;
  onRate: (rating: ReviewRatingName) => void;
  onExit: () => void;
}): ReactElement {
  const { item, labels } = props;
  const locale = props.locale ?? 'zh-CN';
  const copy = cardTutorCopy(locale);
  const cardRef = useRef<HTMLDivElement>(null);
  const frontTextRef = useRef<HTMLParagraphElement>(null);
  const backTextRef = useRef<HTMLParagraphElement>(null);
  const face = props.revealed ? 'back' : 'front';
  const activeTextRef = props.revealed ? backTextRef : frontTextRef;
  const selection = useCardTextSelection({ containerRef: activeTextRef });
  const tutor = useCardTutor();
  const [focusHeading, setFocusHeading] = useState(false);
  const cancelForItemRef = useRef(tutor.cancelForItem);
  cancelForItemRef.current = tutor.cancelForItem;
  const dismissSelectionRef = useRef(selection.dismiss);
  dismissSelectionRef.current = selection.dismiss;

  const restoreCardFocus = useCallback((): void => {
    cardRef.current?.focus();
  }, []);

  const handleFlip = useCallback((): void => {
    selection.dismiss();
    if (tutor.state.itemId === item.card.itemId) {
      tutor.cancel();
    }
    props.onToggleReveal();
  }, [item.card.itemId, props, selection, tutor]);

  const handleRate = useCallback(
    (rating: ReviewRatingName): void => {
      selection.dismiss();
      tutor.cancelForItem(item.card.itemId);
      props.onRate(rating);
    },
    [item.card.itemId, props, selection, tutor],
  );

  const handleExit = useCallback((): void => {
    selection.dismiss();
    tutor.cancelForItem(item.card.itemId);
    props.onExit();
  }, [item.card.itemId, props, selection, tutor]);

  const invokeSelection = useCallback(
    (source: CardTutorInvokeSource = 'pointer'): void => {
      if (!selection.snapshot) return;
      setFocusHeading(source === 'keyboard');
      void tutor.explain({
        itemId: item.card.itemId,
        face,
        selectedText: selection.snapshot.selectedText,
        intent: face === 'front' ? 'hint' : 'explain',
      });
      selection.dismiss();
    },
    [face, item.card.itemId, selection, tutor],
  );

  useEffect(() => {
    dismissSelectionRef.current();
    const itemId = item.card.itemId;
    return () => {
      cancelForItemRef.current(itemId);
    };
  }, [props.revealed, item.card.itemId]);

  const invokeFallback = useCallback((): void => {
    const faceText = face === 'front' ? item.card.front : item.card.back;
    const selectedText = clipSelectionText(faceText);
    if (!selectedText) return;
    setFocusHeading(false);
    void tutor.explain({
      itemId: item.card.itemId,
      face,
      selectedText,
      intent: face === 'front' ? 'hint' : 'explain',
    });
  }, [face, item.card.back, item.card.front, item.card.itemId, tutor]);

  return (
    <>
      <div className="fcws-progress-head">
        <span className="fcws-progress-count">
          {props.position + 1} / {props.total}
        </span>
        {props.isNew && <span className="fcws-new-badge">{labels.newBadge}</span>}
        <span className="fcws-kbd-hints">
          <kbd>Space</kbd> · <kbd>1–4</kbd> · <kbd>Esc</kbd>
        </span>
      </div>
      <div className="fcws-progress-track">
        <div
          className="fcws-progress-fill"
          style={{ width: `${Math.round(((props.position + 1) / Math.max(1, props.total)) * 100)}%` }}
        />
      </div>

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

      <div ref={cardRef} className="fcws-scene" data-testid="flashcards-review-card" tabIndex={0}>
        <div className={`fcws-flipper${props.revealed ? ' is-flipped' : ''}`}>
          <div className="fcws-face fcws-face-front">
            <span className="fcws-face-tag">
              <IconCards width={12} height={12} />
              {item.card.deck}
            </span>
            <p ref={frontTextRef} className="fcws-face-text" data-testid="flashcards-review-front">
              {item.card.front}
            </p>
            <span className="fcws-face-hint">{labels.flipHint}</span>
          </div>
          <div className="fcws-face fcws-face-back">
            <span className="fcws-face-tag is-answer">{labels.answer}</span>
            <p ref={backTextRef} className="fcws-face-text" data-testid="flashcards-review-back">
              {item.card.back}
            </p>
            <span className="fcws-face-hint">{labels.rateHint}</span>
          </div>
        </div>
      </div>

      <CardTutorPanel
        locale={locale}
        itemId={item.card.itemId}
        face={face}
        item={item.card}
        autoFocusHeading={focusHeading}
      />

      <div className="fcws-tear-controls">
        {props.revealed ? (
          <>
            <div className="fcws-rate-bar">
              {RATING_ORDER.map((rating, idx) => (
                <button
                  key={rating}
                  type="button"
                  className={`fcws-rate-btn tone-${rating}`}
                  onClick={() => handleRate(rating)}
                >
                  <kbd>{idx + 1}</kbd>
                  <span>{labels.rateLabels[rating]}</span>
                </button>
              ))}
            </div>
            <Button variant="secondary" data-testid="flashcards-review-flip" onClick={handleFlip}>
              {copy.flipQuestion}
            </Button>
          </>
        ) : (
          <Button variant="secondary" data-testid="flashcards-review-flip" onClick={handleFlip}>
            {labels.revealAnswer}
          </Button>
        )}
        <Button
          variant="ghost"
          size="compact"
          data-testid="card-tutor-fallback"
          onClick={invokeFallback}
        >
          {fallbackActionLabel(locale, face)}
        </Button>
      </div>

      <Button variant="ghost" size="compact" onClick={handleExit}>
        <IconClose width={12} height={12} />
        <span>{labels.exitReview}</span>
      </Button>
    </>
  );
}
