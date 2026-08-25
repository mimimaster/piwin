import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@piwin/ui-kit';
import type {
  FlashcardItem,
  HostResponse,
  ReviewQueueItem,
  ReviewRating,
} from '@piwin/contracts';
import { itemPreviewText } from '@piwin/flashcards/cloze';
import { useDesktopLocale } from './desktop-locale-context';
import {
  downloadFile,
  formatCardsAnkiTsv,
  formatDeckMarkdown,
  formatCardMarkdown,
  copyToClipboard,
} from './knowledge-export';
import {
  IconAlertCircle,
  IconCards,
  IconChat,
  IconCheckCircle,
  IconClose,
  IconCopy,
  IconDocument,
  IconEye,
  IconFlame,
  IconNarrowRight,
  IconRefresh,
  IconSpark,
  IconTable,
  IconTrash,
} from './shell-icons';

export type FlashcardsPanelProps = {
  request: (command:
    | { type: 'flashcards/list'; deck?: string }
    | { type: 'flashcards/delete'; cardId: string }
    | { type: 'flashcards/decks' }
    | { type: 'flashcards/queue'; deck?: string }
    | { type: 'flashcards/rate'; cardId: string; rating: ReviewRating }
    | { type: 'flashcards/export'; deck?: string }
    | { type: 'doccards/open-source'; cardId: string }
  ) => Promise<HostResponse>;
  initialDeckFilter?: string;
  onSendToChat?: (text: string) => void;
};

/**
 * Flashcards panel (ADR 0018 S7): decks, due queue, keyboard-first review flow.
 * Space = reveal, 1–4 = rate. Review state lives in ~/.piwin/flashcards/review.
 */
export function FlashcardsPanel(props: FlashcardsPanelProps) {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [decks, setDecks] = useState<string[]>([]);
  const [deckFilter, setDeckFilter] = useState<string>(props.initialDeckFilter ?? '');
  const [cards, setCards] = useState<FlashcardItem[]>([]);
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reviewingRef = useRef(false);
  const ratingInFlightRef = useRef(false);

  useEffect(() => {
    reviewingRef.current = reviewing;
  }, [reviewing]);

  useEffect(() => {
    if (props.initialDeckFilter !== undefined) {
      setDeckFilter(props.initialDeckFilter);
    }
  }, [props.initialDeckFilter]);

  const request = props.request;
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const decksResponse = await request({ type: 'flashcards/decks' });
    if (decksResponse.success) {
      const decksData = decksResponse.data as { decks: string[] };
      setDecks(decksData.decks ?? []);
    }
    const listResponse = await request({
      type: 'flashcards/list',
      ...(deckFilter ? { deck: deckFilter } : {}),
    });
    if (!listResponse.success) {
      setError(listResponse.error);
      setLoading(false);
      return;
    }
    const listData = listResponse.data as { cards: FlashcardItem[] };
    setCards(listData.cards ?? []);

    const queueResponse = await request({
      type: 'flashcards/queue',
      ...(deckFilter ? { deck: deckFilter } : {}),
    });
    if (queueResponse.success) {
      const queueData = queueResponse.data as { queue: ReviewQueueItem[] };
      setQueue((previous) => (reviewingRef.current ? previous : queueData.queue ?? []));
    }
    setLoading(false);
  }, [request, deckFilter]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const currentItem = reviewing ? queue[position] : undefined;

  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      if (!currentItem || ratingInFlightRef.current) return;
      ratingInFlightRef.current = true;
      try {
        const response = await request({
          type: 'flashcards/rate',
          cardId: currentItem.card.cardId,
          rating,
        });
        if (!response.success) {
          setError(response.error);
          return;
        }
        if (position + 1 >= queue.length) {
          setReviewing(false);
          setInfo(t(`Review completed — ${queue.length} card(s) reviewed`, `本次复习完成 — 已复习 ${queue.length} 张卡片`));
          await loadData();
        } else {
          setPosition(position + 1);
          setRevealed(false);
        }
      } finally {
        ratingInFlightRef.current = false;
      }
    },
    [currentItem, loadData, position, request, queue.length, t],
  );

  useEffect(() => {
    if (!reviewing) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        setRevealed((previous) => !previous);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setReviewing(false);
        return;
      }
      if (!revealed) return;
      if (event.key === '1') {
        event.preventDefault();
        void handleRate('again');
      } else if (event.key === '2') {
        event.preventDefault();
        void handleRate('hard');
      } else if (event.key === '3') {
        event.preventDefault();
        void handleRate('good');
      } else if (event.key === '4') {
        event.preventDefault();
        void handleRate('easy');
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleRate, revealed, reviewing]);

  async function handleDelete(cardId: string): Promise<void> {
    setError(null);
    const response = await request({ type: 'flashcards/delete', cardId });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(t('Card deleted', '已删除卡片'));
    await loadData();
  }

  const handleOpenSource = useCallback(
    async (cardId: string) => {
      const res = await request({ type: 'doccards/open-source', cardId });
      if (res.success) {
        const result = res.data as { path?: string } | undefined;
        if (result?.path) {
          void import('@tauri-apps/plugin-shell')
            .then(({ open }) => open(result.path as string))
            .catch(() => {
              setInfo(t(`Source path: ${result.path}`, `源文件路径：${result.path}`));
            });
        }
      }
    },
    [request, t],
  );

  const handleExportMarkdown = useCallback(() => {
    if (cards.length === 0) return;
    const title = deckFilter || 'piwin-flashcards';
    const content = formatDeckMarkdown(title, cards);
    downloadFile(content, `${title}-cards.md`, 'text/markdown');
    setInfo(t(`Exported ${cards.length} cards as Markdown`, `已导出 ${cards.length} 张卡片为 Markdown 格式`));
  }, [cards, deckFilter, t]);

  const handleExportAnkiTsv = useCallback(() => {
    if (cards.length === 0) return;
    const title = deckFilter || 'piwin-flashcards';
    const content = formatCardsAnkiTsv(cards);
    downloadFile(content, `${title}-anki.tsv`, 'text/tab-separated-values');
    setInfo(t(`Exported ${cards.length} cards as Anki TSV`, `已导出 ${cards.length} 张卡片为 Anki TSV`));
  }, [cards, deckFilter, t]);

  const handleCopyCardMarkdown = useCallback(
    async (card: FlashcardItem) => {
      const md = formatCardMarkdown(card);
      const ok = await copyToClipboard(md);
      if (ok) setInfo(t('Card Markdown copied to clipboard', '已复制卡片 Markdown 到剪贴板'));
    },
    [t],
  );

  const handleSendCardToChat = useCallback(
    (card: FlashcardItem) => {
      if (!props.onSendToChat) return;
      const cardMd = formatCardMarkdown(card);
      const prompt = isZh
        ? `请帮我深入剖析并解答此闪卡知识点：\n\n${cardMd}\n\n我的疑问：`
        : `Please expand and explain this flashcard:\n\n${cardMd}\n\nMy question: `;
      props.onSendToChat(prompt);
    },
    [props, isZh],
  );

  return (
    <div className="flashcards-panel-container" data-testid="flashcards-panel">
      {/* Top Controls Bar */}
      <div className="flashcards-toolbar-card">
        <div className="flashcards-toolbar-top">
          <div className="flashcards-deck-picker">
            <IconCards className="flashcards-deck-icon" />
            <select
              value={deckFilter}
              onChange={(event) => setDeckFilter(event.target.value)}
              data-testid="flashcards-deck-select"
              className="flashcards-deck-select"
              aria-label={t('Filter by Deck', '按卡组筛选')}
            >
              <option value="">{t('All Decks', '全部卡组')} ({cards.length})</option>
              {decks.map((deck) => (
                <option key={deck} value={deck}>
                  {deck}
                </option>
              ))}
            </select>
          </div>

          <div className="flashcards-toolbar-actions">
            <Button
              variant={queue.length > 0 ? 'primary' : 'secondary'}
              disabled={queue.length === 0 || reviewing}
              data-testid="flashcards-review-start"
              onClick={() => {
                setPosition(0);
                setRevealed(false);
                setReviewing(true);
                setInfo(null);
              }}
              className="flashcards-btn-review"
            >
              <IconFlame className="flashcards-btn-icon" />
              <span>{t(`Review (${queue.length} Due)`, `开始复习 (${queue.length} 张到期)`)}</span>
            </Button>

            <Button
              variant="secondary"
              onClick={() => void loadData()}
              title={t('Refresh flashcards', '刷新卡片与队列')}
              aria-label={t('Refresh', '刷新')}
            >
              <IconRefresh className="flashcards-btn-icon" />
              <span>{t('Refresh', '刷新')}</span>
            </Button>

            <Button
              variant="secondary"
              disabled={cards.length === 0}
              onClick={handleExportMarkdown}
              title={t('Export as Markdown Document', '导出为 Markdown 知识库')}
            >
              <IconDocument className="flashcards-btn-icon" />
              <span>{t('Export .MD', '导出 MD')}</span>
            </Button>

            <Button
              variant="ghost"
              data-testid="flashcards-export"
              disabled={cards.length === 0}
              onClick={handleExportAnkiTsv}
              title={t('Export as Anki-importable TSV', '导出为 Anki 兼容的 TSV 格式')}
            >
              <IconTable className="flashcards-btn-icon" />
              <span>{t('Export TSV', '导出 TSV')}</span>
            </Button>
          </div>
        </div>

        <div className="flashcards-stats-strip">
          <div className="flashcards-stat-item">
            <span className="flashcards-stat-label">{t('Total Cards', '卡片总数')}</span>
            <span className="flashcards-stat-value">{cards.length}</span>
          </div>
          <div className="flashcards-stat-divider" />
          <div className="flashcards-stat-item">
            <span className="flashcards-stat-label">{t('Due Today', '今日待复习')}</span>
            <span className={`flashcards-stat-value ${queue.length > 0 ? 'is-due' : ''}`}>
              {queue.length}
            </span>
          </div>
          <div className="flashcards-stat-divider" />
          <div className="flashcards-algorithm-tag" title={t('Free Spaced Repetition Scheduler Algorithm', 'FSRS 间隔重复记忆算法驱动')}>
            <IconSpark className="flashcards-algo-icon" />
            <span>FSRS Engine</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="flashcards-status-banner is-error" role="alert">
          <IconAlertCircle className="flashcards-status-icon" />
          <span>{error}</span>
        </div>
      )}
      {info && (
        <div className="flashcards-status-banner is-info" role="status">
          <IconCheckCircle className="flashcards-status-icon" />
          <span>{info}</span>
        </div>
      )}

      {/* Review Stage */}
      {reviewing && currentItem ? (
        <div className="flashcards-review-stage" data-testid="flashcards-review">
          <header className="flashcards-review-header">
            <div className="flashcards-review-progress">
              <span className="flashcards-progress-badge">
                {position + 1} / {queue.length}
              </span>
              {currentItem.isNew && (
                <span className="flashcards-new-badge">
                  {t('New Card', '新卡片')}
                </span>
              )}
              <span className="flashcards-deck-tag">
                <IconCards className="flashcards-deck-tag-icon" />
                {currentItem.card.deck}
              </span>
            </div>
            <div className="flashcards-keyboard-hints">
              <span className="flashcards-kbd-hint"><kbd>Space</kbd> {t('Flip', '翻转')}</span>
              <span>·</span>
              <span className="flashcards-kbd-hint"><kbd>1–4</kbd> {t('Rate', '评分')}</span>
              <span>·</span>
              <span className="flashcards-kbd-hint"><kbd>Esc</kbd> {t('Exit', '退出')}</span>
            </div>
          </header>

          <div className="flashcards-progress-bar-track">
            <div
              className="flashcards-progress-bar-fill"
              style={{ width: `${Math.round(((position + 1) / queue.length) * 100)}%` }}
            />
          </div>

          <div className="flashcards-card-box">
            <div className="flashcards-question-side">
              <span className="flashcards-box-side-tag">Q</span>
              <div className="flashcards-box-content" data-testid="flashcards-review-front">
                {currentItem.card.front}
              </div>
            </div>

            {revealed ? (
              <div className="flashcards-answer-side">
                <span className="flashcards-box-side-tag is-answer">A</span>
                <div className="flashcards-box-content" data-testid="flashcards-review-back">
                  {currentItem.card.back}
                </div>
                {currentItem.card.sourceExcerpt && (
                  <div className="flashcards-box-source-quote">
                    <IconDocument className="flashcards-quote-icon" />
                    <p>“{currentItem.card.sourceExcerpt}”</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <footer className="flashcards-review-footer">
            {!revealed ? (
              <Button
                variant="primary"
                data-testid="flashcards-reveal"
                onClick={() => setRevealed(true)}
                className="flashcards-reveal-btn"
              >
                <IconEye className="flashcards-btn-icon" />
                <span>{t('Reveal Answer', '查看答案')}</span>
                <kbd className="flashcards-btn-kbd">Space</kbd>
              </Button>
            ) : (
              <div className="flashcards-rate-group">
                <button
                  type="button"
                  className="flashcards-rate-btn tone-again"
                  onClick={() => void handleRate('again')}
                  title={t('Forgot / Again', '忘了 (按键 1)')}
                >
                  <kbd className="flashcards-rate-kbd">1</kbd>
                  <span className="flashcards-rate-label">{t('Again', '忘了')}</span>
                </button>
                <button
                  type="button"
                  className="flashcards-rate-btn tone-hard"
                  onClick={() => void handleRate('hard')}
                  title={t('Hard', '较难 (按键 2)')}
                >
                  <kbd className="flashcards-rate-kbd">2</kbd>
                  <span className="flashcards-rate-label">{t('Hard', '较难')}</span>
                </button>
                <button
                  type="button"
                  className="flashcards-rate-btn tone-good"
                  onClick={() => void handleRate('good')}
                  title={t('Good', '记住了 (按键 3)')}
                >
                  <kbd className="flashcards-rate-kbd">3</kbd>
                  <span className="flashcards-rate-label">{t('Good', '记住了')}</span>
                </button>
                <button
                  type="button"
                  className="flashcards-rate-btn tone-easy"
                  onClick={() => void handleRate('easy')}
                  title={t('Easy', '简单 (按键 4)')}
                >
                  <kbd className="flashcards-rate-kbd">4</kbd>
                  <span className="flashcards-rate-label">{t('Easy', '简单')}</span>
                </button>
              </div>
            )}
            <Button
              variant="ghost"
              size="compact"
              onClick={() => setReviewing(false)}
              className="flashcards-exit-btn"
            >
              <IconClose className="flashcards-btn-icon" />
              <span>{t('Exit Review', '结束复习')}</span>
            </Button>
          </footer>
        </div>
      ) : (
        /* Cards List View */
        <div className="flashcards-list-section">
          {loading ? (
            <p className="flashcards-loading-hint">{t('Loading cards…', '正在加载闪卡…')}</p>
          ) : cards.length === 0 ? (
            <div className="flashcards-empty-card">
              <div className="flashcards-empty-icon-wrap">
                <IconCards className="flashcards-empty-icon" />
              </div>
              <h4 className="flashcards-empty-title">
                {t('No Flashcards Yet', '暂无记忆闪卡')}
              </h4>
              <p className="flashcards-empty-desc">
                {t(
                  'You can generate flashcards from "Doc Cards" tab or during chat conversations with Agent.',
                  '你可以在「文档闪卡」标签页中一键提炼，或在对话中让 Agent 制作记忆闪卡。',
                )}
              </p>
            </div>
          ) : (
            <ul className="flashcards-card-grid" data-testid="flashcards-list">
              {cards.map((card) => (
                <li key={card.id} className="flashcards-grid-item">
                  <div className="flashcards-item-header">
                    <span className="flashcards-item-deck">
                      <IconCards className="flashcards-item-deck-icon" />
                      {card.deck}
                    </span>
                    <div className="flashcards-item-card-actions">
                      <button
                        type="button"
                        className="flashcards-action-icon-btn"
                        onClick={() => void handleCopyCardMarkdown(card)}
                        title={t('Copy Markdown', '复制 Markdown')}
                        aria-label={t('Copy Markdown', '复制 Markdown')}
                      >
                        <IconCopy />
                      </button>
                      {props.onSendToChat && (
                        <button
                          type="button"
                          className="flashcards-action-icon-btn"
                          onClick={() => handleSendCardToChat(card)}
                          title={t('Discuss in Chat', '在对话中讨论')}
                          aria-label={t('Discuss in Chat', '在对话中讨论')}
                        >
                          <IconChat />
                        </button>
                      )}
                      <button
                        type="button"
                        className="flashcards-action-icon-btn is-danger"
                        onClick={() => void handleDelete(card.id)}
                        title={t('Delete Card', '删除卡片')}
                        aria-label={t('Delete Card', '删除卡片')}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>

                  <div className="flashcards-item-body">
                    <div className="flashcards-item-qa-row">
                      <span className="flashcards-qa-tag is-q">Q</span>
                      <p className="flashcards-item-front">{itemPreviewText(card)}</p>
                    </div>
                    <div className="flashcards-item-qa-row">
                      <span className="flashcards-qa-tag is-a">A</span>
                      <p className="flashcards-item-back">{card.back ?? card.text ?? ''}</p>
                    </div>
                  </div>

                  {card.sourceFile && (
                    <footer
                      className="flashcards-item-footer"
                      onClick={() => void handleOpenSource(card.id)}
                      title={t('Click to open in local editor', '点击在本地编辑器中打开')}
                    >
                      <span className="flashcards-source-badge">
                        <IconDocument className="flashcards-source-icon" />
                        <span className="flashcards-source-path">
                          {card.sourceFile}
                          {typeof card.sourceLine === 'number' ? `:${card.sourceLine}` : ''}
                        </span>
                        <IconNarrowRight className="flashcards-source-arrow" />
                      </span>
                    </footer>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
