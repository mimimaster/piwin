import type { ReactElement, RefObject, MouseEvent } from 'react';
import type { FlashcardReviewCard } from '@piwin/contracts';
import { MarkdownView } from '../MarkdownView';
import type { FlashcardChatCopy } from './flashcard-chat-copy';
import { FlashcardRateBar, type FlashcardRateName } from './flashcard-rate-bar';

export function FlashcardChatFaces(props: {
  card: FlashcardReviewCard;
  copy: FlashcardChatCopy;
  locale: 'zh-CN' | 'en';
  flipped: boolean;
  isFlipping: boolean;
  cardIndex: number | undefined;
  totalCards: number | undefined;
  frontBodyRef: RefObject<HTMLDivElement | null>;
  backBodyRef: RefObject<HTMLDivElement | null>;
  sourcePath: string;
  hasSource: boolean;
  rated: string | null;
  onRate: (rating: FlashcardRateName) => void;
  onChangeRated: () => void;
  onToggleSource: (event: MouseEvent) => void;
}): ReactElement {
  const deckName = props.card.deck || props.copy.unnamedDeck;
  const showIndex =
    typeof props.cardIndex === 'number' &&
    typeof props.totalCards === 'number' &&
    props.totalCards > 1;

  return (
    <article
      className={`fc-quiet-frame${props.flipped ? ' is-flipped' : ''}${props.isFlipping ? ' is-flipping' : ''}`}
      aria-label={props.flipped ? 'Flashcard back' : 'Flashcard front'}
    >
      <div className={`fc-quiet-face fc-quiet-front${!props.flipped ? ' is-active' : ' is-hidden'}`}>
        <div className="fc-quiet-header">
          <div className="fc-quiet-meta">
            <span className="fc-quiet-deck">{deckName}</span>
            {Array.isArray(props.card.tags) && props.card.tags.length > 0 ? (
              <span className="fc-quiet-tag">#{props.card.tags[0]}</span>
            ) : null}
          </div>
          <div className="fc-quiet-tools">
            {showIndex ? (
              <span className="fc-quiet-index">
                {props.cardIndex! + 1} / {props.totalCards}
              </span>
            ) : null}
            <span className="fc-quiet-flip-badge">
              <span>{props.copy.flipToAnswer}</span>
              <kbd>Space</kbd>
            </span>
          </div>
        </div>
        <div ref={props.frontBodyRef} className="fc-quiet-body fc-quiet-question">
          <MarkdownView
            text={props.card.front}
            renderingPhase="completed"
            showStreamingCaret={false}
            locale={props.locale}
            artifactPreviewEnabled={false}
          />
        </div>
      </div>

      <div className={`fc-quiet-face fc-quiet-back${props.flipped ? ' is-active' : ' is-hidden'}`}>
        <div className="fc-quiet-header">
          <div className="fc-quiet-meta">
            <span className="fc-quiet-deck">{deckName}</span>
            <span className="fc-quiet-answer-pill">{props.copy.answer}</span>
          </div>
          <div className="fc-quiet-tools">
            <span className="fc-quiet-flip-badge">
              <span>{props.copy.flipBack}</span>
              <kbd>Space</kbd>
            </span>
          </div>
        </div>
        <div ref={props.backBodyRef} className="fc-quiet-body fc-quiet-answer">
          {props.flipped ? (
            <MarkdownView
              text={props.card.back}
              renderingPhase="completed"
              showStreamingCaret={false}
              locale={props.locale}
              artifactPreviewEnabled={false}
            />
          ) : null}
          {props.hasSource ? (
            <div className="fc-quiet-source-row">
              <button
                type="button"
                className="fc-quiet-source-btn"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onToggleSource(event);
                }}
              >
                <span>{props.copy.source}:</span>
                <span className="fc-quiet-source-path">{props.sourcePath}</span>
              </button>
            </div>
          ) : null}
        </div>
        {props.card.ordinal > 0 ? (
          <FlashcardRateBar
            copy={props.copy}
            rated={props.rated}
            onRate={props.onRate}
            onChange={props.onChangeRated}
          />
        ) : null}
      </div>
    </article>
  );
}
