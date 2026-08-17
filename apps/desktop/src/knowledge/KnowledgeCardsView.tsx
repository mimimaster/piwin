/**
 * View B: Flashcards Pipeline & FSRS Review.
 * Combines batch generation from RAG slices, card gallery, and immersive FSRS review.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { Button, IconButton, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../desktop-locale-context.js';
import type {
  FlashcardRecord,
  GenerationJob,
  HostResponse,
  ReviewRating,
} from '@piwin/contracts';
import { DocCardItem } from '../DocCardItem.js';
import {
  copyToClipboard,
  downloadFile,
  formatCardsAnkiTsv,
  formatDeckMarkdown,
} from '../knowledge-export.js';
import {
  IconCards,
  IconCopy,
  IconDownload,
} from '../shell-icons.js';

export type KnowledgeCardsViewProps = {
  folderPath: string;
  folderName: string;
  cards: FlashcardRecord[];
  generationJob: GenerationJob | null;
  busy: boolean;
  request: (command: any) => Promise<HostResponse>;
  onStartGeneration: (topic?: string) => void;
  onSendToChat?: ((card: FlashcardRecord) => void) | undefined;
  onOpenSourceFile?: ((cardId: string) => void) | undefined;
  onOpenSession?: ((sessionId: string) => void) | undefined;
};

const TOPIC_SUGGESTIONS = [
  { labelZh: '核心架构与模块分层', labelEn: 'Architecture & Layering' },
  { labelZh: '关键接口与契约规约', labelEn: 'API Contracts & Interfaces' },
  { labelZh: '并发控制与状态机', labelEn: 'Concurrency & State Machines' },
  { labelZh: '常见踩坑与注意事项', labelEn: 'Common Pitfalls & Invariants' },
];

export function KnowledgeCardsView(props: KnowledgeCardsViewProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [mode, setMode] = useState<'gallery' | 'review'>('gallery');
  const [topic, setTopic] = useState('');
  const [copiedAll, setCopiedAll] = useState(false);

  // FSRS Review State
  const [reviewIndex, setReviewIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);

  const isGenerating =
    Boolean(props.generationJob) &&
    props.generationJob?.status !== 'COMPLETED' &&
    props.generationJob?.status !== 'COMPLETED_DEGRADED' &&
    props.generationJob?.status !== 'FAILED' &&
    props.generationJob?.status !== 'CANCELED';

  // FSRS Keyboard listener during review mode
  useEffect(() => {
    if (mode !== 'review') return;

    function handleKeyDown(e: KeyboardEvent): void {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setRevealed((r) => !r);
      } else if (revealed && ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Key1', 'Key2', 'Key3', 'Key4', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'].includes(e.code)) {
        e.preventDefault();
        const ratingMap: Record<string, ReviewRating> = {
          Digit1: 'again', Key1: 'again', Numpad1: 'again',
          Digit2: 'hard', Key2: 'hard', Numpad2: 'hard',
          Digit3: 'good', Key3: 'good', Numpad3: 'good',
          Digit4: 'easy', Key4: 'easy', Numpad4: 'easy',
        };
        const rating = ratingMap[e.code];
        if (rating) {
          void handleRate(rating);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, revealed, reviewIndex, props.cards]);

  async function handleRate(rating: ReviewRating): Promise<void> {
    const currentCard = props.cards[reviewIndex];
    if (!currentCard || ratingBusy) return;
    setRatingBusy(true);
    try {
      await props.request({
        type: 'flashcards/rate',
        cardId: currentCard.id,
        rating,
      });
      setRevealed(false);
      if (reviewIndex + 1 < props.cards.length) {
        setReviewIndex((i) => i + 1);
      } else {
        setMode('gallery');
        setReviewIndex(0);
      }
    } finally {
      setRatingBusy(false);
    }
  }

  function handleCopyAll(): void {
    if (props.cards.length === 0) return;
    const text = formatDeckMarkdown(props.folderName, props.cards);
    copyToClipboard(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 1500);
  }

  function handleExportAnki(): void {
    if (props.cards.length === 0) return;
    const tsv = formatCardsAnkiTsv(props.cards);
    downloadFile(`${props.folderName}-anki.tsv`, tsv, 'text/tab-separated-values');
  }

  function handleExportMarkdown(): void {
    if (props.cards.length === 0) return;
    const md = formatDeckMarkdown(props.folderName, props.cards);
    downloadFile(`${props.folderName}-flashcards.md`, md, 'text/markdown');
  }

  const currentReviewCard = props.cards[reviewIndex];

  return (
    <div className="knowledge-cards-view" data-testid="knowledge-cards-view">
      {/* Top Flashcard Generation Banner */}
      <div className="cards-generation-banner">
        <div className="generation-input-row">
          <TextInput
            placeholder={t(
              'Enter distillation topic (e.g. Architecture, Core APIs, Concurrency, Pitfalls)...',
              '输入提炼主题（如：核心架构、关键接口、并发机制、避坑规约）...',
            )}
            value={topic}
            onChange={(e) => setTopic(e.currentTarget.value)}
            className="topic-input"
            disabled={isGenerating || props.busy}
          />
          <Button
            variant="primary"
            size="compact"
            onClick={() => props.onStartGeneration(topic || undefined)}
            disabled={isGenerating || props.busy}
            data-testid="generate-cards-btn"
            className="generate-action-btn"
          >
            <IconCards width={14} height={14} />
            <span>
              {isGenerating ? t('Distilling...', '正在提炼...') : t('⚡ Distill Cards', '⚡ 批量提炼闪卡')}
            </span>
          </Button>
          {props.generationJob?.sessionId && props.onOpenSession ? (
            <Button
              variant="secondary"
              size="compact"
              onClick={() => props.onOpenSession?.(props.generationJob!.sessionId!)}
              data-testid="open-review-session-btn"
            >
              {t('Open review session', '打开复习会话')}
            </Button>
          ) : null}
        </div>

        {/* Quick Topic Pills */}
        <div className="topic-suggestions">
          <span className="suggestions-label muted">{t('Suggested topics:', '推荐主题:')}</span>
          {TOPIC_SUGGESTIONS.map((item) => (
            <button
              key={item.labelEn}
              type="button"
              className="topic-pill-btn"
              onClick={() => setTopic(isZh ? item.labelZh : item.labelEn)}
            >
              {isZh ? item.labelZh : item.labelEn}
            </button>
          ))}
        </div>
      </div>

      {/* Mode Switcher & Export Toolbar */}
      <div className="cards-toolbar">
        <div className="cards-mode-toggle">
          <button
            type="button"
            className={`mode-tab-btn${mode === 'gallery' ? ' active' : ''}`}
            onClick={() => setMode('gallery')}
            data-testid="gallery-mode-btn"
          >
            {t(`Gallery (${props.cards.length})`, `卡片画廊 (${props.cards.length})`)}
          </button>
          <button
            type="button"
            className={`mode-tab-btn${mode === 'review' ? ' active' : ''}`}
            onClick={() => {
              setMode('review');
              setReviewIndex(0);
              setRevealed(false);
            }}
            disabled={props.cards.length === 0}
            data-testid="review-mode-btn"
          >
            {t('🎯 FSRS Review', '🎯 FSRS 科学复习')}
          </button>
        </div>

        <div className="cards-export-actions">
          <IconButton
            label={copiedAll ? t('Copied!', '已复制') : t('Copy all as Markdown', '复制全部 Markdown')}
            onClick={handleCopyAll}
            disabled={props.cards.length === 0}
            data-testid="copy-all-cards-btn"
          >
            <IconCopy width={14} height={14} />
          </IconButton>
          <Button
            variant="secondary"
            size="compact"
            onClick={handleExportAnki}
            disabled={props.cards.length === 0}
            data-testid="export-anki-btn"
          >
            <IconDownload width={12} height={12} />
            <span>{t('Anki TSV', '导出 Anki')}</span>
          </Button>
          <Button
            variant="secondary"
            size="compact"
            onClick={handleExportMarkdown}
            disabled={props.cards.length === 0}
            data-testid="export-md-btn"
          >
            <IconDownload width={12} height={12} />
            <span>{t('Markdown', '导出 MD')}</span>
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="cards-stage-body">
        {props.cards.length === 0 ? (
          <div className="cards-empty-state">
            <div className="empty-hero-icon">
              <IconCards width={36} height={36} />
            </div>
            <h3>{t('No flashcards generated yet', '暂无知识闪卡')}</h3>
            <p className="muted">
              {t(
                'Click "⚡ Distill Cards" above to automatically extract structured Q&A cards from indexed slices.',
                '点击上方「⚡ 批量提炼闪卡」，Agent 将自动基于已索引切片提炼出问答卡片与代码溯源。',
              )}
            </p>
          </div>
        ) : mode === 'review' && currentReviewCard ? (
          /* FSRS Review Mode */
          <div className="fsrs-review-container" data-testid="fsrs-review-container">
            <div className="review-progress-bar">
              <span className="review-card-counter">
                {t(`Card ${reviewIndex + 1} of ${props.cards.length}`, `第 ${reviewIndex + 1} / ${props.cards.length} 张`)}
              </span>
              <Button size="compact" variant="ghost" onClick={() => setMode('gallery')}>
                {t('Exit Review', '退出复习')}
              </Button>
            </div>

            <div
              className={`fsrs-review-card${revealed ? ' revealed' : ''}`}
              onClick={() => setRevealed((r) => !r)}
            >
              <div className="review-card-question">
                <span className="card-side-tag front">{t('Question / Concept', '正面 · 概念提问')}</span>
                <div className="card-front-text">{currentReviewCard.front}</div>
              </div>

              {revealed ? (
                <div className="review-card-answer">
                  <span className="card-side-tag back">{t('Answer / Details', '背面 · 核心解答')}</span>
                  <div className="card-back-text">{currentReviewCard.back}</div>
                  {currentReviewCard.sourceFile ? (
                    <div className="card-review-source">
                      <span className="source-label">📄 {currentReviewCard.sourceFile}:{currentReviewCard.sourceLine ?? 1}</span>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="review-flip-hint">
                  <span className="key-pill">Space ␣</span>
                  <span>{t('Flip to reveal answer', '点击或按空格翻转查看答案')}</span>
                </div>
              )}
            </div>

            {revealed ? (
              <div className="fsrs-rating-bar">
                <button
                  type="button"
                  className="rating-btn again"
                  onClick={() => void handleRate('again')}
                  disabled={ratingBusy}
                >
                  <span className="rating-num">1</span>
                  <span className="rating-name">{t('Again', '重来')}</span>
                </button>
                <button
                  type="button"
                  className="rating-btn hard"
                  onClick={() => void handleRate('hard')}
                  disabled={ratingBusy}
                >
                  <span className="rating-num">2</span>
                  <span className="rating-name">{t('Hard', '困难')}</span>
                </button>
                <button
                  type="button"
                  className="rating-btn good"
                  onClick={() => void handleRate('good')}
                  disabled={ratingBusy}
                >
                  <span className="rating-num">3</span>
                  <span className="rating-name">{t('Good', '良好')}</span>
                </button>
                <button
                  type="button"
                  className="rating-btn easy"
                  onClick={() => void handleRate('easy')}
                  disabled={ratingBusy}
                >
                  <span className="rating-num">4</span>
                  <span className="rating-name">{t('Easy', '简单')}</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          /* Gallery Mode */
          <div className="cards-gallery-grid">
            {props.cards.map((card) => (
              <DocCardItem
                key={card.id}
                card={card}
                onSendToChat={props.onSendToChat}
                onOpenSource={props.onOpenSourceFile}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
