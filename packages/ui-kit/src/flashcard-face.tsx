import { useRef, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode } from 'react';
import {
  hasSelectionInside,
  isInteractiveClickTarget,
  shouldFlipOnClick,
} from './flashcard-face-click.js';

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
  /**
   * Whole-card click flips (2026-09-03 spec §3). Drag-selecting text, clicking
   * while a selection exists, or clicking an interactive element never flips.
   * Keyboard flipping stays with the shell's study keyboard handler.
   */
  onFlip?: () => void;
  contentTestId?: string;
  className?: string;
};

type PressState = {
  clientX: number;
  clientY: number;
  selectionExisted: boolean;
};

function joinClassNames(...parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

/**
 * Existing Desktop tear-card face. Content is a ReactNode slot — no Markdown,
 * Host, or filesystem.
 */
export function FlashcardFace(props: FlashcardFaceProps): ReactElement {
  const pressRef = useRef<PressState | null>(null);
  const className = joinClassNames(
    'fcws-tear-card',
    props.tearing && 'is-tearing',
    props.revealed && 'is-revealed',
    props.className,
  );

  const onPointerDown = (event: PointerEvent<HTMLElement>): void => {
    if (!props.onFlip) return;
    pressRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      selectionExisted: hasSelectionInside(event.currentTarget),
    };
  };

  const onClick = (event: MouseEvent<HTMLElement>): void => {
    const onFlip = props.onFlip;
    const press = pressRef.current;
    pressRef.current = null;
    if (!onFlip) return;
    const card = event.currentTarget;
    const travel = press
      ? Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY)
      : 0;
    const flip = shouldFlipOnClick({
      pointerTravelPx: travel,
      selectionExistedOnPress: press?.selectionExisted ?? false,
      selectionExistsOnClick: hasSelectionInside(card),
      targetIsInteractive: isInteractiveClickTarget(event.target, card),
    });
    if (flip) onFlip();
  };

  return (
    <article
      className={className}
      data-testid="flashcards-tear-card"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      <div className="fcws-tear-card-top">
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