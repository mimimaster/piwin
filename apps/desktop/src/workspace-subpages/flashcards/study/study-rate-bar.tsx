import type { ReactElement } from 'react';
import type { ReviewRating } from '@piwin/contracts';
import type { FlashcardStudyCopy } from './study-copy';

const RATE_ORDER: readonly ReviewRating[] = ['again', 'hard', 'good', 'easy'];

export function StudyRateBar(props: {
  copy: FlashcardStudyCopy;
  disabled?: boolean;
  onRate: (rating: ReviewRating) => void;
}): ReactElement {
  return (
    <div className="flashcards-rate-group" data-testid="flashcards-study-rate-bar">
      {RATE_ORDER.map((rating, index) => (
        <button
          key={rating}
          type="button"
          className={`flashcards-rate-btn tone-${rating}`}
          data-testid={`flashcards-study-rate-${rating}`}
          disabled={props.disabled === true}
          onClick={() => props.onRate(rating)}
          title={`${props.copy[rating]} (${index + 1})`}
        >
          <kbd className="flashcards-rate-kbd">{index + 1}</kbd>
          <span className="flashcards-rate-label">{props.copy[rating]}</span>
        </button>
      ))}
    </div>
  );
}
