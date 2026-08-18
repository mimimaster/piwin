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
  const flipTimerRef = useRef<number | null>(null);

  // Clean up animation timer on unmount
  useEffect(() => {
    return () => {
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
        flipTimerRef.current = null;
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
    }, 550);
  };

  const handleRate = (rating: 'again' | 'hard' | 'good' | 'easy', label: string): void => {
    setRated(label);
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
        handleRate('good', isZh ? '记住了' : 'Good');
      } else if (e.key === '4') {
        e.preventDefault();
        handleRate('easy', isZh ? '简单' : 'Easy');
      }
    }
  };

  return (
    <div
      className="fc-quiet-card-container"
      data-card-id={card.cardId}
      data-testid="chat-flashcard"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* 3D Flip Frame */}
      <div
        className={`fc-quiet-frame${flipped ? ' is-flipped' : ''}${isFlipping ? ' is-flipping' : ''}`}
        onClick={handleToggleFlip}
        role="button"
        tabIndex={0}
        aria-label={flipped ? 'Flashcard back' : 'Flashcard front'}
      >
        {/* Front Face: Question */}
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

            <div className="fc-quiet-tools">
              {typeof cardIndex === 'number' && typeof totalCards === 'number' && totalCards > 1 ? (
                <span className="fc-quiet-index">
                  {cardIndex + 1} / {totalCards}
                </span>
              ) : null}
              <span className="fc-quiet-flip-badge">
                <span>{isZh ? '翻看解答' : 'Flip'}</span>
                <kbd>Space</kbd>
              </span>
            </div>
          </div>

          <div className="fc-quiet-body fc-quiet-question">
            <MarkdownView
              text={card.front}
              renderingPhase="completed"
              showStreamingCaret={false}
              locale={locale}
              artifactPreviewEnabled={false}
            />
          </div>
        </div>

        {/* Back Face: Answer */}
        <div
          className={`fc-quiet-face fc-quiet-back${flipped ? ' is-active' : ' is-hidden'}`}
        >
          <div className="fc-quiet-header">
            <div className="fc-quiet-meta">
              <span className="fc-quiet-deck">{card.deck || (isZh ? '闪卡' : 'Card')}</span>
              <span className="fc-quiet-answer-pill">{isZh ? '解答' : 'Answer'}</span>
            </div>

            <div className="fc-quiet-tools">
              <span className="fc-quiet-flip-badge">
                <span>{isZh ? '翻回' : 'Flip back'}</span>
                <kbd>Space</kbd>
              </span>
            </div>
          </div>

          <div className="fc-quiet-body fc-quiet-answer">
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
                  <span>📎 {isZh ? '来源' : 'Source'}:</span>
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
                  <span>{isZh ? '忘了' : 'Again'}</span>
                </button>
                <button
                  type="button"
                  className="fc-quiet-rate-btn btn-hard"
                  onClick={() => handleRate('hard', isZh ? '较难' : 'Hard')}
                >
                  <span className="fc-rate-key">2</span>
                  <span>{isZh ? '较难' : 'Hard'}</span>
                </button>
                <button
                  type="button"
                  className="fc-quiet-rate-btn btn-good"
                  onClick={() => handleRate('good', isZh ? '记住了' : 'Good')}
                >
                  <span className="fc-rate-key">3</span>
                  <span>{isZh ? '记住了' : 'Good'}</span>
                </button>
                <button
                  type="button"
                  className="fc-quiet-rate-btn btn-easy"
                  onClick={() => handleRate('easy', isZh ? '简单' : 'Easy')}
                >
                  <span className="fc-rate-key">4</span>
                  <span>{isZh ? '简单' : 'Easy'}</span>
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

  const handlePrev = useCallback((): void => {
    setActiveIndex((prev) => (prev > 0 ? prev - 1 : cards.length - 1));
  }, [cards.length]);

  const handleNext = useCallback((): void => {
    setActiveIndex((prev) => (prev < cards.length - 1 ? prev + 1 : 0));
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
          {isZh ? `卡片 (${cards.length})` : `Cards (${cards.length})`}
        </span>
        <div className="fc-quiet-nav-actions">
          <button
            type="button"
            className="fc-quiet-nav-btn"
            onClick={handlePrev}
            aria-label="Previous card"
            title={isZh ? '上一张' : 'Previous'}
          >
            ‹
          </button>
          <span className="fc-quiet-nav-count">
            {safeIndex + 1} / {cards.length}
          </span>
          <button
            type="button"
            className="fc-quiet-nav-btn"
            onClick={handleNext}
            aria-label="Next card"
            title={isZh ? '下一张' : 'Next'}
          >
            ›
          </button>
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
