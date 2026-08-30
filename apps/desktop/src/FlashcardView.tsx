import { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';
import type { FlashcardReviewCard } from '@piwin/contracts';
import type { ArtifactActionMessage } from '@piwin/artifact';
import { collapseToPhysicalCards } from '@piwin/flashcards/cloze';
import { MarkdownView } from './MarkdownView';

export type FlashcardViewProps = {
  card: FlashcardReviewCard;
  onAction?: (action: ArtifactActionMessage) => void;
  locale?: 'zh-CN' | 'en' | undefined;
  cardIndex?: number | undefined;
  totalCards?: number | undefined;
};

export function FlashcardView({
  card,
  onAction,
  locale = 'zh-CN',
  cardIndex,
  totalCards,
}: FlashcardViewProps): ReactElement {
  const [flipped, setFlipped] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [rated, setRated] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [selectedText, setSelectedText] = useState('');
  const [pillPos, setPillPos] = useState<{ x: number; y: number } | null>(null);
  const [peeling, setPeeling] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const flipTimerRef = useRef<number | null>(null);
  const peelTimerRef = useRef<number | null>(null);

  // Clean up animation timers on unmount
  useEffect(() => {
    return () => {
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
        flipTimerRef.current = null;
      }
      if (peelTimerRef.current !== null) {
        window.clearTimeout(peelTimerRef.current);
        peelTimerRef.current = null;
      }
    };
  }, []);

  const isZh = locale === 'zh-CN';
  const hasSource = Boolean(card.sourceFolder || card.sourceNoteId);
  const sourcePath = card.sourceFile
    ? `${card.sourceFile}${card.sourceLine && card.sourceLine > 0 ? `:${card.sourceLine}` : ''}`
    : card.sourceNoteId
      ? `note:${card.sourceNoteId}`
      : '';

  const handleToggleFlip = (): void => {
    if (flipTimerRef.current !== null) {
      window.clearTimeout(flipTimerRef.current);
    }
    setIsFlipping(true);
    setFlipped((prev) => !prev);
    flipTimerRef.current = window.setTimeout(() => {
      setIsFlipping(false);
      flipTimerRef.current = null;
    }, 400);
  };

  const handleMouseDown = (e: React.MouseEvent): void => {
    startPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleFrameClick = (e: React.MouseEvent): void => {
    const dist = Math.hypot(
      e.clientX - startPosRef.current.x,
      e.clientY - startPosRef.current.y,
    );
    const currentSelection = window.getSelection()?.toString().trim();

    // Drag threshold or active selection: suppress flip
    if (dist > 4 || (currentSelection && currentSelection.length > 0)) {
      return;
    }

    // Dismiss active pill on clean click
    if (selectedText.length > 0) {
      setSelectedText('');
      setPillPos(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    handleToggleFlip();
  };

  const handleRate = (rating: 'again' | 'hard' | 'good' | 'easy', label: string): void => {
    setRated(label);
    setPeeling(true);
    if (peelTimerRef.current !== null) {
      window.clearTimeout(peelTimerRef.current);
    }
    peelTimerRef.current = window.setTimeout(() => {
      setPeeling(false);
      peelTimerRef.current = null;
    }, 240);

    if (onAction) {
      onAction({
        type: 'piwin-artifact:action',
        channelId: card.cardId,
        action: 'flashcard/rate',
        payload: {
          cardId: card.cardId,
          rating,
        },
      });
    }
  };

  const handleOpenSource = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (onAction) {
      onAction({
        type: 'piwin-artifact:action',
        channelId: card.cardId,
        action: 'flashcard/open-source',
        payload: {
          cardId: card.cardId,
          openFile: true,
        },
      });
    }
  };

  const handleExplainSelected = (e: React.MouseEvent): void => {
    e.stopPropagation();
    const term = selectedText;
    setSelectedText('');
    setPillPos(null);
    window.getSelection()?.removeAllRanges();

    if (onAction && term) {
      onAction({
        type: 'piwin-artifact:action',
        channelId: card.cardId,
        action: 'composer/propose-text',
        payload: {
          text: `针对闪卡《${card.front}》，请详细讲解其中的概念「${term}」。`,
          label: `讲解「${term}」`,
        },
      });
    }
  };

  // Listen to text selection across the card
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

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggleFlip();
    } else if (flipped && rated === null && card.ordinal > 0) {
      if (e.key === '1') {
        e.preventDefault();
        handleRate('again', isZh ? '忘了' : 'Again');
      } else if (e.key === '2') {
        e.preventDefault();
        handleRate('hard', isZh ? '较难' : 'Hard');
      } else if (e.key === '3') {
        e.preventDefault();
        handleRate('good', isZh ? '记住' : 'Good');
      } else if (e.key === '4') {
        e.preventDefault();
        handleRate('easy', isZh ? '简单' : 'Easy');
      }
    }
  };

  return (
    <div
      ref={containerRef}
      className={`fc-quiet-card-container${peeling ? ' fc-quiet-peeling' : ''}`}
      data-card-id={card.cardId}
      data-testid="chat-flashcard"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
    >
      {/* Physical Stack Depth Layer */}
      {totalCards && totalCards > 1 && cardIndex !== undefined && cardIndex < totalCards - 1 ? (
        <div className="fc-quiet-stack-layer" />
      ) : null}

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
            {isZh
              ? `讲解「${selectedText.length > 8 ? selectedText.slice(0, 8) + '…' : selectedText}」`
              : `Explain "${selectedText.length > 8 ? selectedText.slice(0, 8) + '…' : selectedText}"`}
          </span>
          <span className="fc-selection-enter">↵</span>
        </button>
      ) : null}

      {/* 3D Flip Frame */}
      <div
        className={`fc-quiet-frame${flipped ? ' is-flipped' : ''}${isFlipping ? ' is-flipping' : ''}`}
        onClick={handleFrameClick}
        role="button"
        tabIndex={0}
        aria-label={flipped ? 'Flashcard back' : 'Flashcard front'}
      >
        {/* Front Face: Pure Concept Question */}
        <div
          className={`fc-quiet-face fc-quiet-front${!flipped ? ' is-active' : ' is-hidden'}`}
        >
          <div className="fc-quiet-header">
            <div className="fc-quiet-meta">
              <span className="fc-quiet-deck">{card.deck || (isZh ? '闪卡' : 'Card')}</span>
              {Array.isArray(card.tags) && card.tags.length > 0 ? (
                <span className="fc-quiet-tag">#{card.tags[0]}</span>
              ) : null}
            </div>

            {typeof cardIndex === 'number' && typeof totalCards === 'number' && totalCards > 1 ? (
              <span className="fc-quiet-index">
                {cardIndex + 1} / {totalCards}
              </span>
            ) : null}
          </div>

          <div className="fc-quiet-body fc-quiet-question fc-quiet-text-zone">
            <MarkdownView
              text={card.front}
              renderingPhase="completed"
              showStreamingCaret={false}
              locale={locale}
              artifactPreviewEnabled={false}
            />
          </div>
        </div>

        {/* Back Face: High Density Substantive Answer */}
        <div
          className={`fc-quiet-face fc-quiet-back${flipped ? ' is-active' : ' is-hidden'}`}
        >
          <div className="fc-quiet-header">
            <div className="fc-quiet-meta">
              <span className="fc-quiet-deck">{card.deck || (isZh ? '闪卡' : 'Card')}</span>
              {Array.isArray(card.tags) && card.tags.length > 0 ? (
                <span className="fc-quiet-tag">#{card.tags[0]}</span>
              ) : null}
            </div>

            {typeof cardIndex === 'number' && typeof totalCards === 'number' && totalCards > 1 ? (
              <span className="fc-quiet-index">
                {cardIndex + 1} / {totalCards}
              </span>
            ) : null}
          </div>

          <div className="fc-quiet-body fc-quiet-answer fc-quiet-text-zone">
            {flipped ? (
              <MarkdownView
                text={card.back}
                renderingPhase="completed"
                showStreamingCaret={false}
                locale={locale}
                artifactPreviewEnabled={false}
              />
            ) : null}

            {hasSource ? (
              <div className="fc-quiet-source-row">
                <button
                  type="button"
                  className="fc-quiet-source-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSourceOpen((prev) => !prev);
                  }}
                >
                  <span>📎</span>
                  <span className="fc-quiet-source-path">{sourcePath}</span>
                </button>
              </div>
            ) : null}
          </div>

          {/* Preview cards (ordinal 0) are one physical cloze note — flip only. */}
          {card.ordinal > 0 && rated === null ? (
            <div
              className="fc-quiet-footer chat-flashcard-rate-section"
              data-testid="chat-flashcard-rate-section"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="fc-quiet-rating-bar">
                <button
                  type="button"
                  className="fc-quiet-rate-btn btn-again"
                  onClick={() => handleRate('again', isZh ? '忘了' : 'Again')}
                >
                  <span className="fc-rate-key">1</span>
                  <span className="fc-rate-label">{isZh ? '忘了' : 'Again'}</span>
                  <span className="fc-rate-interval">10m</span>
                </button>
                <button
                  type="button"
                  className="fc-quiet-rate-btn btn-hard"
                  onClick={() => handleRate('hard', isZh ? '较难' : 'Hard')}
                >
                  <span className="fc-rate-key">2</span>
                  <span className="fc-rate-label">{isZh ? '较难' : 'Hard'}</span>
                  <span className="fc-rate-interval">1d</span>
                </button>
                <button
                  type="button"
                  className="fc-quiet-rate-btn btn-good"
                  onClick={() => handleRate('good', isZh ? '记住' : 'Good')}
                >
                  <span className="fc-rate-key">3</span>
                  <span className="fc-rate-label">{isZh ? '记住' : 'Good'}</span>
                  <span className="fc-rate-interval">3d</span>
                </button>
                <button
                  type="button"
                  className="fc-quiet-rate-btn btn-easy"
                  onClick={() => handleRate('easy', isZh ? '简单' : 'Easy')}
                >
                  <span className="fc-rate-key">4</span>
                  <span className="fc-rate-label">{isZh ? '简单' : 'Easy'}</span>
                  <span className="fc-rate-interval">7d</span>
                </button>
              </div>
            </div>
          ) : card.ordinal > 0 ? (
            <div
              className="fc-quiet-footer fc-quiet-rated-bar chat-flashcard-done-badge"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="fc-quiet-rated-msg">
                ✓ {isZh ? `已记录：${rated}` : `Rated: ${rated}`}
              </span>
              <button
                type="button"
                className="fc-quiet-change-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  setRated(null);
                }}
              >
                {isZh ? '修改' : 'Change'}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Source Citation Popover */}
      {sourceOpen && hasSource ? (
        <div className="fc-quiet-source-popover" onClick={(e) => e.stopPropagation()}>
          <div className="fc-quiet-popover-header">
            <span className="fc-quiet-popover-path">📄 {sourcePath}</span>
            {card.sourceFile ? (
              <button
                type="button"
                className="fc-quiet-open-btn"
                onClick={handleOpenSource}
              >
                {isZh ? '打开源文件' : 'Open'} ↗
              </button>
            ) : null}
          </div>
          {card.sourceExcerpt ? (
            <div className="fc-quiet-popover-excerpt">{card.sourceExcerpt}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FlashcardStackView(props: {
  cards: FlashcardReviewCard[];
  onAction?: (action: ArtifactActionMessage) => void;
  locale?: 'zh-CN' | 'en' | undefined;
}): ReactElement {
  const cards = collapseToPhysicalCards(props.cards);
  const { onAction, locale = 'zh-CN' } = props;
  const isZh = locale === 'zh-CN';
  const [activeIndex, setActiveIndex] = useState(0);

  const safeIndex = Math.min(Math.max(0, activeIndex), Math.max(0, cards.length - 1));
  const activeCard = cards[safeIndex];

  const handleTear = useCallback((): void => {
    setActiveIndex((prev) => (prev < cards.length - 1 ? prev + 1 : prev));
  }, [cards.length]);

  if (!cards || cards.length === 0 || !activeCard) {
    return <div className="fc-quiet-empty" />;
  }

  // Single card mode: render direct minimalist card
  if (cards.length === 1) {
    return (
      <div className="fc-quiet-stack">
        <FlashcardView
          card={activeCard}
          {...(onAction ? { onAction } : {})}
          locale={locale}
        />
      </div>
    );
  }

  // Multi-card deck mode: minimalist navigation bar
  return (
    <div className="fc-quiet-stack is-multi">
      <div className="fc-quiet-nav">
        <span className="fc-quiet-nav-label">
          {isZh ? `一套 (${cards.length})` : `Set (${cards.length})`}
        </span>
        <div className="fc-quiet-nav-actions">
          <span className="fc-quiet-nav-count">
            {safeIndex + 1} / {cards.length}
          </span>
          {safeIndex < cards.length - 1 ? (
            <button
              type="button"
              className="fc-quiet-nav-btn"
              onClick={handleTear}
              aria-label={isZh ? '撕掉' : 'Tear'}
              title={isZh ? '撕掉' : 'Tear'}
              data-testid="flashcard-tear-next"
            >
              {isZh ? '撕掉' : 'Tear'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="fc-quiet-stage">
        <FlashcardView
          key={activeCard.cardId}
          card={activeCard}
          cardIndex={safeIndex}
          totalCards={cards.length}
          {...(onAction ? { onAction } : {})}
          locale={locale}
        />
      </div>
    </div>
  );
}

