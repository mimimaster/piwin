import type { ReactElement, ReactNode } from 'react';

export type FlashcardFaceProps = {
  /** Question vs answer presentation class (`is-revealed`). */
  revealed?: boolean;
  /** Leaving snapshot class (`is-tearing`). */
  tearing?: boolean;
  deckName: ReactNode;
  tag?: ReactNode;
  indexTag?: ReactNode;
  /** Rendered question or answer. Shells pass their Markdown renderer. */
  content: ReactNode;
  source?: ReactNode;
  onFlip?: () => void;
  contentTestId?: string;
  className?: string;
};

function joinClassNames(...parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

/**
 * Existing Desktop tear-card face. Content is a ReactNode slot — no Markdown,
 * Host, or filesystem.
 */
export function FlashcardFace(props: FlashcardFaceProps): ReactElement {
  const className = joinClassNames(
    'fcws-tear-card',
    props.tearing && 'is-tearing',
    props.revealed && 'is-revealed',
    props.className,
  );
  return (
    <article className={className} data-testid="flashcards-tear-card" tabIndex={0}>
      <div className="fcws-tear-card-top" onClick={props.onFlip}>
        <div className="fcws-tear-meta">
          <span className="fcws-tear-deck-name">{props.deckName}</span>
          {props.tag}
        </div>
        {props.indexTag}
      </div>
      <div className="fcws-tear-text-wrap fc-quiet-text-zone">
        <div className="fcws-tear-content" data-testid={props.contentTestId}>
          {props.content}
        </div>
      </div>
      {props.source}
    </article>
  );
}
