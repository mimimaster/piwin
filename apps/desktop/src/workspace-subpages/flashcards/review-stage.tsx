import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { ReviewQueueItem } from '@piwin/contracts';
import { IconCards, IconClose } from '../../shell-icons';

export type ReviewRatingName = 'again' | 'hard' | 'good' | 'easy';

const RATING_ORDER: readonly ReviewRatingName[] = ['again', 'hard', 'good', 'easy'];

/**
 * The immersive flip-card review stage: progress header, one card, and either
 * the reveal button or the four FSRS rating buttons. Pure presentation —
 * state and scheduling live in the parent.
 */
export function ReviewStage(props: {
  item: ReviewQueueItem;
  position: number;
  total: number;
  revealed: boolean;
  isNew: boolean;
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

      <div
        className="fcws-scene"
        data-testid="flashcards-review-card"
        onClick={props.onToggleReveal}
      >
        <div className={`fcws-flipper${props.revealed ? ' is-flipped' : ''}`}>
          <div className="fcws-face fcws-face-front">
            <span className="fcws-face-tag">
              <IconCards width={12} height={12} />
              {item.card.deck}
            </span>
            <p className="fcws-face-text" data-testid="flashcards-review-front">
              {item.card.front}
            </p>
            <span className="fcws-face-hint">{labels.flipHint}</span>
          </div>
          <div className="fcws-face fcws-face-back">
            <span className="fcws-face-tag is-answer">{labels.answer}</span>
            <p className="fcws-face-text" data-testid="flashcards-review-back">
              {item.card.back}
            </p>
            <span className="fcws-face-hint">{labels.rateHint}</span>
          </div>
        </div>
      </div>

      {props.revealed ? (
        <div className="fcws-rate-bar">
          {RATING_ORDER.map((rating, idx) => (
            <button
              key={rating}
              type="button"
              className={`fcws-rate-btn tone-${rating}`}
              onClick={() => props.onRate(rating)}
            >
              <kbd>{idx + 1}</kbd>
              <span>{labels.rateLabels[rating]}</span>
            </button>
          ))}
        </div>
      ) : (
        <Button variant="secondary" onClick={props.onToggleReveal}>
          {labels.revealAnswer}
        </Button>
      )}

      <Button variant="ghost" size="compact" onClick={props.onExit}>
        <IconClose width={12} height={12} />
        <span>{labels.exitReview}</span>
      </Button>
    </>
  );
}
