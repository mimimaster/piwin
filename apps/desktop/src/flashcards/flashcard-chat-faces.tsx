import type { ReactElement, RefObject, MouseEvent } from 'react';
import type { FlashcardReviewCard } from '@piwin/contracts';
import { MarkdownView } from '../MarkdownView';
import type { FlashcardChatCopy } from './flashcard-chat-copy';

export function FlashcardChatFaces(props: {
  card: FlashcardReviewCard;
  copy: FlashcardChatCopy;
  locale: 'zh-CN' | 'en';
  flipped: boolean;
  isFlipping: boolean;
  frontBodyRef: RefObject<HTMLDivElement | null>;
  backBodyRef: RefObject<HTMLDivElement | null>;
  sourcePath: string;
  hasSource: boolean;
  onToggleFlip: () => void;
  onToggleSource: (event: MouseEvent) => void;
}): ReactElement {
  const tags = Array.isArray(props.card.tags) ? props.card.tags.filter(Boolean) : [];

  const handleFlipClick = (event: MouseEvent): void => {
    if (event.target instanceof HTMLElement && event.target.closest('button, a')) {
      return;
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      const anchor = selection.anchorNode;
      const flipEl = event.currentTarget;
      if (anchor && flipEl.contains(anchor)) {
        return;
      }
    }
    props.onToggleFlip();
  };

  return (
    <div
      className={`flip${props.flipped ? ' is-back' : ''}${props.isFlipping ? ' is-flipping' : ''}`}
      data-testid="chat-flashcard-flip"
      role="button"
      tabIndex={-1}
      aria-label={props.flipped ? props.copy.flipBack : props.copy.flipToAnswer}
      onClick={handleFlipClick}
    >
      <div className="face front" aria-hidden={props.flipped}>
        <span className="mic">{props.copy.questionMic}</span>
        <div ref={props.frontBodyRef} className="q">
          <MarkdownView
            text={props.card.front}
            renderingPhase="completed"
            showStreamingCaret={false}
            locale={props.locale}
            artifactPreviewEnabled={false}
          />
        </div>
        {tags.length > 0 ? (
          <div className="tags">
            {tags.map((tag) => (
              <span key={tag} className="tag">
                {tag}
              </span>
            ))}
          </div>
        ) : null}
        <span className="hint">{props.copy.clickToFlip}</span>
      </div>

      <div className="face back" aria-hidden={!props.flipped}>
        <span className="mic">{props.copy.answerMic}</span>
        <div ref={props.backBodyRef} className="a">
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
            <button
              type="button"
              className="fc-source-link"
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleSource(event);
              }}
            >
              <span>{props.copy.source}:</span> {props.sourcePath}
            </button>
          ) : null}
        </div>
        <span className="hint">{props.copy.flipBack}</span>
      </div>
    </div>
  );
}
