import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Button, showUiNotification } from '@piwin/ui-kit';
import type { FlashcardItem } from '@piwin/contracts';
import { itemPreviewText } from '@piwin/flashcards/cloze';
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
}): ReactElement {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [tearing, setTearing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [pillPos, setPillPos] = useState<{ x: number; y: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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
        setSelectedText('');
        setPillPos(null);
      }, 200);
    } else {
      setCompleted(true);
    }
  }, [hasNext, tearing]);

  const restart = useCallback(() => {
    setIndex(0);
    setRevealed(false);
    setCompleted(false);
    setSelectedText('');
    setPillPos(null);
  }, []);

  const handleMouseDown = (e: React.MouseEvent): void => {
    startPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleCardClick = (e: React.MouseEvent): void => {
    const dist = Math.hypot(
      e.clientX - startPosRef.current.x,
      e.clientY - startPosRef.current.y,
    );
    const currentSelection = window.getSelection()?.toString().trim();

    // Suppress flip if user was dragging or has active text selection
    if (dist > 4 || (currentSelection && currentSelection.length > 0)) {
      return;
    }

    if (selectedText.length > 0) {
      setSelectedText('');
      setPillPos(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    setRevealed((prev) => !prev);
  };

  const handleExplainSelected = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const term = selectedText;
    setSelectedText('');
    setPillPos(null);
    window.getSelection()?.removeAllRanges();

    if (term && current) {
      const q = current.front || current.text || '';
      const prompt = `针对闪卡《${q}》，请详细讲解其中的概念「${term}」。`;
      void navigator.clipboard?.writeText(prompt).catch(() => {});
      showUiNotification({
        message: `已复制追问指令：「${prompt}」`,
        tone: 'info',
      });
    }
  };

  // Selection change tracking for floating pill
  useEffect(() => {
    const handleSelectionChange = (): void => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length === 0 || !containerRef.current) {
        setPillPos(null);
        setSelectedText('');
        return;
      }

      if (sel && sel.anchorNode && containerRef.current.contains(sel.anchorNode)) {
        setSelectedText(text);
        try {
          const range = sel.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          setPillPos({
            x: rect.left + rect.width / 2 - containerRect.left,
            y: rect.top - containerRect.top - 6,
          });
        } catch {
          setPillPos(null);
        }
      } else {
        setPillPos(null);
        setSelectedText('');
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (completed) {
        if (event.key === 'Enter') {
          restart();
        }
        return;
      }
      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        setRevealed((prev) => !prev);
      } else if (event.key === 'Enter' || event.key === 'ArrowRight') {
        event.preventDefault();
        if (!revealed) {
          setRevealed(true);
        } else {
          tear();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [completed, revealed, restart, tear]);

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
          <Button variant="secondary" onClick={props.onClose}>
            {props.labels.close}
          </Button>
        </div>
      </div>
    );
  }

  const progressPercent = Math.round(((index + 1) / total) * 100);

  return (
    <div className="fcws-tear" data-testid="flashcards-tear" ref={containerRef}>
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
          onClick={props.onClose}
          title="Close (Esc)"
          aria-label={props.labels.close}
        >
          <IconClose width={14} height={14} />
          <span>{props.labels.close}</span>
        </button>
      </header>

      {/* Floating Selection Tooltip Pill */}
      {pillPos && selectedText ? (
        <button
          type="button"
          className="fc-selection-pill"
          style={{ left: `${pillPos.x}px`, top: `${pillPos.y}px` }}
          onClick={handleExplainSelected}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="fc-selection-icon">✨</span>
          <span>
            {`讲解「${selectedText.length > 8 ? selectedText.slice(0, 8) + '…' : selectedText}」`}
          </span>
          <span className="fc-selection-enter">↵</span>
        </button>
      ) : null}

      <main className="fcws-tear-stage">
        <div
          className={`fcws-tear-card${tearing ? ' is-tearing' : ''}${revealed ? ' is-revealed' : ''}`}
          data-testid="flashcards-tear-card"
          onClick={handleCardClick}
          onMouseDown={handleMouseDown}
          role="button"
          tabIndex={0}
        >
          <div className="fcws-tear-card-top">
            <div className="fcws-tear-meta">
              <span className="fcws-tear-deck-name">{current.deck || '闪卡'}</span>
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
              <span>📎 {current.sourceFile}</span>
            </div>
          ) : null}
        </div>
      </main>

      <footer className="fcws-tear-actions">
        <Button
          variant="secondary"
          size="default"
          onClick={() => setRevealed((prev) => !prev)}
        >
          <span>{revealed ? '翻看提问' : '查看答案'}</span>
          <kbd className="fc-rate-key">Space</kbd>
        </Button>

        {hasNext ? (
          <Button variant="primary" size="default" data-testid="flashcards-tear-next" onClick={tear}>
            {props.labels.tear}
          </Button>
        ) : (
          <Button variant="primary" size="default" onClick={() => setCompleted(true)}>
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


