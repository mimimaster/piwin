import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { FlashcardItem } from '@piwin/contracts';
import { itemPreviewText } from '@piwin/flashcards/cloze';
import { IconCheck, IconClose, IconRefresh, IconTrash } from '../../shell-icons';
import { MarkdownView } from '../../MarkdownView';
import { type TearDeckLabels, tearDeckLabels } from './tear-deck-copy';

export type { TearDeckLabels };

export function TearDeck(props: {
  cards: FlashcardItem[];
  labels?: TearDeckLabels;
  onClose: () => void;
  onDeleteCard?: (cardId: string) => void;
  onDeleteSet?: () => void;
  locale?: 'zh-CN' | 'en';
  initialIndex?: number;
}): ReactElement {
  const locale = props.locale ?? 'zh-CN';
  const labels = props.labels ?? tearDeckLabels(locale);
  const [index, setIndex] = useState(() => {
    const start = props.initialIndex ?? 0;
    if (props.cards.length === 0) return 0;
    return Math.min(Math.max(0, start), props.cards.length - 1);
  });
  const [revealed, setRevealed] = useState(false);
  const [tearing, setTearing] = useState(false);
  const [completed, setCompleted] = useState(false);

  const current = props.cards[index];
  const total = props.cards.length;
  const hasNext = index < total - 1;

  const tear = useCallback(() => {
    if (tearing) return;
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
  }, [hasNext, tearing]);

  const restart = useCallback(() => {
    setIndex(0);
    setRevealed(false);
    setCompleted(false);
  }, []);

  const toggleReveal = useCallback((): void => {
    setRevealed((prev) => !prev);
  }, []);

  const closeDeck = useCallback((): void => {
    props.onClose();
  }, [props]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (event.repeat) return;
      if (event.key === 'Escape' && !typing) {
        event.preventDefault();
        closeDeck();
        return;
      }
      if (typing || (target !== null && target.tagName === 'BUTTON')) {
        return;
      }
      if (completed) {
        if (event.key === 'Enter') {
          restart();
        }
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
  }, [closeDeck, completed, revealed, restart, tear, toggleReveal]);

  if (!current || completed) {
    return (
      <div className="fcws-tear fcws-tear-completed" data-testid="flashcards-tear">
        <div className="fcws-tear-completed-icon">
          <IconCheck width={32} height={32} />
        </div>
        <h3>{labels.completedTitle}</h3>
        <p className="fcws-tear-completed-desc" data-testid="flashcards-tear-completed-desc">
          {labels.completedDescription(total)}
        </p>
        <div className="fcws-tear-actions fcws-tear-completed-actions">
          <Button variant="primary" onClick={restart}>
            <IconRefresh width={14} height={14} />
            <span>{labels.restart}</span>
          </Button>
          <Button variant="secondary" onClick={closeDeck}>
            {labels.close}
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
          title={labels.close}
          aria-label={labels.close}
        >
          <IconClose width={14} height={14} />
          <span>{labels.close}</span>
        </button>
      </header>

      <main className="fcws-tear-stage">
        <article
          className={`fcws-tear-card${tearing ? ' is-tearing' : ''}${revealed ? ' is-revealed' : ''}`}
          data-testid="flashcards-tear-card"
          tabIndex={0}
        >
          <div className="fcws-tear-card-top" onClick={toggleReveal}>
            <div className="fcws-tear-meta">
              <span className="fcws-tear-deck-name">{current.deck || labels.unnamedDeck}</span>
              {Array.isArray(current.tags) && current.tags.length > 0 ? (
                <span className="fcws-tear-tag">#{current.tags[0]}</span>
              ) : null}
            </div>
            <span className="fcws-tear-index-tag">#{index + 1}</span>
          </div>

          <div className="fcws-tear-text-wrap fc-quiet-text-zone">
            <div
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
      </main>

      <footer className="fcws-tear-actions">
        <Button variant="secondary" size="default" onClick={toggleReveal}>
          <span>{revealed ? labels.question : labels.answer}</span>
          <kbd className="fc-rate-key">Space</kbd>
        </Button>

        {hasNext ? (
          <Button variant="primary" size="default" data-testid="flashcards-tear-next" onClick={tear}>
            {labels.tear}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="default"
            data-testid="flashcards-tear-end"
            onClick={() => setCompleted(true)}
          >
            {labels.lastCard}
          </Button>
        )}
        {props.onDeleteCard ? (
          <Button
            variant="ghost"
            size="compact"
            className="fcws-tear-danger"
            data-testid="flashcards-tear-delete-card"
            onClick={() => props.onDeleteCard?.(current.id)}
          >
            <IconTrash width={13} height={13} />
            <span>{labels.deleteCard}</span>
          </Button>
        ) : null}
        {props.cards.length > 1 && props.onDeleteSet ? (
          <Button
            variant="ghost"
            size="compact"
            className="fcws-tear-danger"
            data-testid="flashcards-tear-delete-set"
            onClick={props.onDeleteSet}
          >
            {labels.deleteSet}
          </Button>
        ) : null}
      </footer>
    </div>
  );
}
