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
      <div className="rate chat-flashcard-done-badge">
        <span className="m">{props.copy.rated(props.rated)}</span>
        <button type="button" className="btn sm" onClick={props.onChange}>
          {props.copy.change}
        </button>
      </div>
    );
  }

  return (
    <div className="rate chat-flashcard-rate-section" data-testid="chat-flashcard-rate-section">
      {RATE_ORDER.map((rating, index) => (
        <button
          key={rating}
          type="button"
          className={`btn sm btn-${rating}`}
          onClick={() => props.onRate(rating)}
        >
          <span className="bd">{index + 1}</span>
          {flashcardRateLabel(props.copy, rating)}
        </button>
      ))}
      <span className="m">{props.copy.rateHint}</span>
    </div>
  );
}
