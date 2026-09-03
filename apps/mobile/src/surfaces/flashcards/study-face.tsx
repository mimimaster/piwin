import type { ReactElement, ReactNode } from 'react';
import { Button, FlashcardFace } from '@piwin/ui-kit';
import type { FlashcardStudyContentProjection, ReviewRating } from '@piwin/contracts';
import { MobileMarkdown } from '../../components/chat/MobileMarkdown.js';
import {
  MOBILE_SOURCE_FULL_OPEN_HINT,
  mobileSourceProjection,
} from './catalog-paths.js';
import type { MobileFlashcardStudyCopy } from './study-copy.js';
import { StudyRateBar } from './study-rate-bar.js';

export function markdownContent(text: string): ReactNode {
  return <MobileMarkdown content={text} />;
}

export function renderStudyFace(
  current: FlashcardStudyContentProjection,
  copy: MobileFlashcardStudyCopy,
  options: { tearing: boolean; revealed: boolean; onFlip: () => void },
): ReactElement {
  const text = options.revealed ? (current.back ?? '') : current.front;
  const source = mobileSourceProjection({
    ...(current.sourceTitle !== undefined ? { sourceTitle: current.sourceTitle } : {}),
    ...(current.sourceExcerpt !== undefined ? { sourceExcerpt: current.sourceExcerpt } : {}),
  });
  return (
    <FlashcardFace
      tearing={options.tearing}
      revealed={options.revealed}
      deckName={current.deck || copy.unnamedDeck}
      tag={
        current.tags && current.tags.length > 0 ? (
          <span className="fcws-tear-tag">#{current.tags[0]}</span>
        ) : null
      }
      indexTag={
        current.siblingOrdinal !== undefined && current.siblingCount !== undefined ? (
          <span className="fcws-tear-index-tag">
            {copy.sibling(current.siblingOrdinal, current.siblingCount)}
          </span>
        ) : null
      }
      contentTestId={options.revealed ? 'flashcards-tear-back' : 'flashcards-tear-front'}
      onFlip={options.onFlip}
      content={markdownContent(text)}
      source={
        source.title || source.excerpt ? (
          <div className="fcws-tear-source-line" data-testid="flashcards-study-source">
            {source.title ? <span>{source.title}</span> : null}
            {source.excerpt ? <span className="mobile-flashcards-source-excerpt">{source.excerpt}</span> : null}
            <span className="mobile-flashcards-source-hint">{MOBILE_SOURCE_FULL_OPEN_HINT}</span>
          </div>
        ) : null
      }
    />
  );
}

export function renderStudyActions(input: {
  copy: MobileFlashcardStudyCopy;
  mode: 'sequence' | 'scheduled';
  revealed: boolean;
  hasNext: boolean;
  busy: boolean;
  needsReview: boolean;
  onFlip: () => void;
  onNext: () => void;
  onRate: (rating: ReviewRating) => void;
  onNeedsReview: () => void;
}): ReactElement {
  const { copy } = input;
  // Flip is secondary: tapping the card flips it (spec 2026-09-03 §3).
  const flipButton = (
    <Button variant="ghost" size="compact" onClick={input.onFlip} disabled={input.busy}>
      <span>{input.revealed ? copy.question : copy.answer}</span>
    </Button>
  );
  if (input.mode === 'scheduled') {
    // Rate bar keeps its slot before reveal so the layout does not jump.
    return (
      <footer className="fcws-tear-actions fcws-study-rate-actions">
        <StudyRateBar
          copy={copy}
          disabled={input.busy || !input.revealed}
          onRate={input.onRate}
        />
        {flipButton}
      </footer>
    );
  }
  return (
    <footer className="fcws-tear-actions">
      {flipButton}
      {input.mode === 'sequence' ? (
        input.hasNext ? (
          <Button
            variant="primary"
            size="default"
            data-testid="flashcards-tear-next"
            disabled={input.busy}
            onClick={input.onNext}
          >
            {copy.next}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="default"
            data-testid="flashcards-tear-end"
            disabled={input.busy}
            onClick={input.onNext}
          >
            {copy.lastCard}
          </Button>
        )
      ) : null}
      {input.mode === 'sequence' ? (
        <Button
          variant="ghost"
          size="compact"
          data-testid="flashcards-study-needs-review"
          disabled={input.busy}
          onClick={input.onNeedsReview}
        >
          {input.needsReview ? copy.needsReviewOn : copy.needsReview}
        </Button>
      ) : null}
    </footer>
  );
}

/** During tear: blank back of the incoming current card. Idle: blank next shell. No Q/A. */
export function blankIncomingUnderShell(
  tearing: boolean,
  hasIncoming: boolean,
  hasNext: boolean,
): ReactElement | null {
  if ((tearing && hasIncoming) || (!tearing && hasNext)) {
    return (
      <article
        className="fcws-tear-card"
        aria-hidden="true"
        data-testid="flashcards-study-under-shell"
      />
    );
  }
  return null;
}
