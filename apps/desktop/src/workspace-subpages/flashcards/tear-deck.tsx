import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { FlashcardItem, FlashcardTutorFace } from '@piwin/contracts';
import { itemPreviewText } from '@piwin/flashcards/cloze';
import { CardSelectionPopover } from '../../flashcards/card-selection-popover';
import type { CardTutorInvokeSource } from '../../flashcards/card-selection-keys';
import { CardTutorPanel } from '../../flashcards/card-tutor-panel';
import { cardTutorCopy, fallbackActionLabel } from '../../flashcards/card-tutor-copy';
import { clipSelectionText } from '../../flashcards/card-text-selection';
import { useCardTutor } from '../../flashcards/card-tutor-provider';
import { useCardTextSelection } from '../../flashcards/use-card-text-selection';
import { IconCheck, IconClose, IconRefresh, IconTrash } from '../../shell-icons';
import { MarkdownView } from '../../MarkdownView';

export type TearDeckLabels = {
  flipHint: string;
  tear: string;
  lastCard: string;
  close: string;
  deleteCard: string;
  deleteSet: string;
  answer: string;
  question: string;
  remaining: (count: number) => string;
  revealShortcut: string;
  nextShortcut: string;
  completedTitle: string;
  completedDescription: (count: number) => string;
  restart: string;
};

export function TearDeck(props: {
  cards: FlashcardItem[];
  labels: TearDeckLabels;
  onClose: () => void;
  onDeleteCard?: (cardId: string) => void;
  onDeleteSet?: () => void;
  locale?: 'zh-CN' | 'en';
}): ReactElement {
  const locale = props.locale ?? 'zh-CN';
  const copy = cardTutorCopy(locale);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tearing, setTearing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [focusHeading, setFocusHeading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const selection = useCardTextSelection({ containerRef: textRef, enabled: !completed });
  const tutor = useCardTutor();

  const current = props.cards[index];
  const total = props.cards.length;
  const hasNext = index < total - 1;
  const face: FlashcardTutorFace = revealed ? 'back' : 'front';

  const dismissTutor = useCallback((): void => {
    selection.dismiss();
    tutor.cancel();
  }, [selection, tutor]);

  const tear = useCallback(() => {
    if (tearing) return;
    dismissTutor();
    if (hasNext) {
      setTearing(true);
      window.setTimeout(() => {
        setIndex((prev) => prev + 1);
        setRevealed(false);
        setTearing(false);
      }, 200);
    } else {
      setCompleted(true);
    }
  }, [dismissTutor, hasNext, tearing]);

  const restart = useCallback(() => {
    dismissTutor();
    setIndex(0);
    setRevealed(false);
    setCompleted(false);
  }, [dismissTutor]);

  const toggleReveal = useCallback((): void => {
    selection.dismiss();
    if (current && tutor.state.itemId === current.id) {
      tutor.cancel();
    }
    setRevealed((prev) => !prev);
  }, [current, selection, tutor]);

  const closeDeck = useCallback((): void => {
    dismissTutor();
    props.onClose();
  }, [dismissTutor, props]);

  const restoreCardFocus = useCallback((): void => {
    cardRef.current?.focus();
  }, []);

  const invokeSelection = useCallback(
    (source: CardTutorInvokeSource = 'pointer'): void => {
      if (!current || !selection.snapshot) return;
      setFocusHeading(source === 'keyboard');
      void tutor.explain({
        itemId: current.id,
        face,
        selectedText: selection.snapshot.selectedText,
        intent: face === 'front' ? 'hint' : 'explain',
      });
      selection.dismiss();
    },
    [current, face, selection, tutor],
  );

  const invokeFallback = useCallback((): void => {
    if (!current) return;
    const faceText = revealed
      ? (current.back ?? current.text ?? '')
      : itemPreviewText(current);
    const selectedText = clipSelectionText(faceText);
    if (!selectedText) return;
    void tutor.explain({
      itemId: current.id,
      face,
      selectedText,
      intent: face === 'front' ? 'hint' : 'explain',
    });
  }, [current, face, revealed, tutor]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'BUTTON' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.repeat) return;
      if (completed) {
        if (event.key === 'Enter') {
          restart();
        }
        return;
      }
      if (selection.snapshot) {
        return;
      }
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        toggleReveal();
      } else if (event.key === 'Enter' || event.key === 'ArrowRight') {
        event.preventDefault();
        if (!revealed) {
          toggleReveal();
        } else {
          tear();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [completed, revealed, restart, selection.snapshot, tear, toggleReveal]);

  useEffect(() => {
    return () => {
      tutor.cancel();
    };
    // TearDeck unmount cancels whatever this surface started.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!current || completed) {
    return (
      <div className="fcws-tear fcws-tear-completed" data-testid="flashcards-tear">
        <div className="fcws-tear-completed-icon">
          <IconCheck width={32} height={32} />
        </div>
        <h3>{props.labels.completedTitle}</h3>
        <p className="fcws-tear-completed-desc">{props.labels.completedDescription(total)}</p>
        <div className="fcws-tear-actions fcws-tear-completed-actions">
          <Button variant="primary" onClick={restart}>
            <IconRefresh width={14} height={14} />
            <span>{props.labels.restart}</span>
          </Button>
          <Button variant="secondary" onClick={closeDeck}>
            {props.labels.close}
          </Button>
        </div>
      </div>
    );
  }

  const progressPercent = Math.round(((index + 1) / total) * 100);

  return (
    <div className="fcws-tear" data-testid="flashcards-tear">
      <header className="fcws-tear-toolbar">
        <div className="fcws-tear-progress-wrap">
          <span className="fcws-tear-count" data-testid="flashcards-tear-count">
            {index + 1} / {total}
          </span>
          <div className="fcws-tear-progress-bar">
            <div className="fcws-tear-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
        <button
          type="button"
          className="fcws-tear-close"
          onClick={closeDeck}
          title="Close (Esc)"
          aria-label={props.labels.close}
        >
          <IconClose width={14} height={14} />
          <span>{props.labels.close}</span>
        </button>
      </header>

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

      <main className="fcws-tear-stage">
        <article
          ref={cardRef}
          className={`fcws-tear-card${tearing ? ' is-tearing' : ''}${revealed ? ' is-revealed' : ''}`}
          data-testid="flashcards-tear-card"
          tabIndex={0}
        >
          <div className="fcws-tear-card-top" onClick={toggleReveal}>
            <div className="fcws-tear-meta">
              <span className="fcws-tear-deck-name">{current.deck || (locale === 'en' ? 'Card' : '闪卡')}</span>
              {Array.isArray(current.tags) && current.tags.length > 0 ? (
                <span className="fcws-tear-tag">#{current.tags[0]}</span>
              ) : null}
            </div>
            <span className="fcws-tear-index-tag">#{index + 1}</span>
          </div>

          <div className="fcws-tear-text-wrap fc-quiet-text-zone">
            <div
              ref={textRef}
              className="fcws-tear-content"
              data-testid={revealed ? 'flashcards-tear-back' : 'flashcards-tear-front'}
            >
              <MarkdownView
                text={revealed ? (current.back ?? current.text ?? '') : itemPreviewText(current)}
                renderingPhase="completed"
                showStreamingCaret={false}
                artifactPreviewEnabled={false}
              />
            </div>
          </div>

          {current.sourceFile ? (
            <div className="fcws-tear-source-line">
              <span>{current.sourceFile}</span>
            </div>
          ) : null}
        </article>

        <CardTutorPanel
          locale={locale}
          itemId={current.id}
          face={face}
          item={current}
          autoFocusHeading={focusHeading}
        />
      </main>

      <footer className="fcws-tear-actions">
        <Button variant="secondary" size="default" onClick={toggleReveal}>
          <span>{revealed ? copy.flipQuestion : copy.flipAnswer}</span>
          <kbd className="fc-rate-key">Space</kbd>
        </Button>
        <Button variant="ghost" size="default" data-testid="card-tutor-fallback" onClick={invokeFallback}>
          {fallbackActionLabel(locale, face)}
        </Button>

        {hasNext ? (
          <Button variant="primary" size="default" data-testid="flashcards-tear-next" onClick={tear}>
            {props.labels.tear}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="default"
            onClick={() => {
              dismissTutor();
              setCompleted(true);
            }}
          >
            {props.labels.lastCard}
          </Button>
        )}
        {props.onDeleteCard ? (
          <Button
            variant="ghost"
            size="compact"
            data-testid="flashcards-tear-delete-card"
            onClick={() => props.onDeleteCard?.(current.id)}
          >
            <IconTrash width={13} height={13} />
            <span>{props.labels.deleteCard}</span>
          </Button>
        ) : null}
        {props.cards.length > 1 && props.onDeleteSet ? (
          <Button
            variant="ghost"
            size="compact"
            data-testid="flashcards-tear-delete-set"
            onClick={props.onDeleteSet}
          >
            {props.labels.deleteSet}
          </Button>
        ) : null}
      </footer>
    </div>
  );
}
