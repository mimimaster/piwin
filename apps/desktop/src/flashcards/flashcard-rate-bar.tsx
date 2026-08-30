import type { ReactElement } from 'react';
import type { FlashcardChatCopy } from './flashcard-chat-copy';
import { flashcardRateLabel } from './flashcard-chat-copy';

export type FlashcardRateName = 'again' | 'hard' | 'good' | 'easy';

const RATE_ORDER: readonly FlashcardRateName[] = ['again', 'hard', 'good', 'easy'];

export function FlashcardRateBar(props: {
  copy: FlashcardChatCopy;
  rated: string | null;
  onRate: (rating: FlashcardRateName) => void;
  onChange: () => void;
}): ReactElement {
  if (props.rated !== null) {
    return (
      <div className="fc-quiet-footer fc-quiet-rated-bar chat-flashcard-done-badge">
        <span className="fc-quiet-rated-msg">{props.copy.rated(props.rated)}</span>
        <button type="button" className="fc-quiet-change-btn" onClick={props.onChange}>
          {props.copy.change}
        </button>
      </div>
    );
  }

  return (
    <div
      className="fc-quiet-footer chat-flashcard-rate-section"
      data-testid="chat-flashcard-rate-section"
    >
      <div className="fc-quiet-rating-bar">
        {RATE_ORDER.map((rating, index) => (
          <button
            key={rating}
            type="button"
            className={`fc-quiet-rate-btn btn-${rating}`}
            onClick={() => props.onRate(rating)}
          >
            <span className="fc-rate-key">{index + 1}</span>
            <span>{flashcardRateLabel(props.copy, rating)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
