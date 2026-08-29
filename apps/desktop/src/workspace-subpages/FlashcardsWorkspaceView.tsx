import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  Button,
  EmptyState,
  IconButton,
  Notice,
  SegmentedControl,
  Spinner,
} from '@piwin/ui-kit';
import type { FlashcardCreateInput, FlashcardItem } from '@piwin/contracts';
import { itemPreviewText } from '@piwin/flashcards/cloze';
import {
  IconArrowLeft,
  IconCards,
  IconCheckCircle,
  IconClose,
  IconFlame,
  IconPlus,
  IconSpark,
  IconTrash,
} from '../shell-icons';
import type { DesktopLocale } from '../desktop-locale';
import { useCardTutorOnCreated } from '../flashcards/card-tutor-provider';
import {
  useFlashcardsWorkspace,
  type FlashcardsRequester,
} from './flashcards/use-flashcards-workspace';
import { ReviewStage, type ReviewRatingName } from './flashcards/review-stage';
import { TearDeck } from './flashcards/tear-deck';
import { tearDeckLabels } from './flashcards/tear-deck-copy';
import { browseStartIndex, cardsForBrowse } from './flashcards/browse-set';
import { CreateCardDialog, GenerateCardsDialog } from './flashcards/workspace-dialogs';

export type FlashcardsWorkspaceViewProps = {
  locale?: DesktopLocale;
  onClose: () => void;
  onSendToChat?: (text: string) => void;
  /** Host command requester — wired to the workbench HostClient. */
  request: FlashcardsRequester;
};

const RATING_ORDER = ['again', 'hard', 'good', 'easy'] as const;

/**
 * Flashcards workspace: review-first. The rail carries a compact overview and
 * the deck list; the canvas is either the immersive review stage or the card
 * library. Manual creation and AI generation open dialogs instead of owning
 * tabs, so reviewing always stays the default landing surface.
 *
 * Data comes from real Host commands (ADR 0018): decks/list/queue on load,
 * rate/delete/create mutate and reload.
 */
export function FlashcardsWorkspaceView(props: FlashcardsWorkspaceViewProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const [deckFilter, setDeckFilter] = useState('');
  const [surface, setSurface] = useState<'review' | 'library'>('review');
  const [reviewing, setReviewing] = useState(false);
  const [position, setPosition] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [newDeck, setNewDeck] = useState('');
  const [newFront, setNewFront] = useState('');
  const [newBack, setNewBack] = useState('');
  const [generateTopic, setGenerateTopic] = useState('');
  const [browse, setBrowse] = useState<{
    cards: FlashcardItem[];
    focusId: string;
    startIndex: number;
  } | null>(null);
  const ratingInFlight = useRef(false);
  const restoreBrowseFocusId = useRef<string | null>(null);
  const browseLocale = isZh ? 'zh-CN' : 'en';

  const ws = useFlashcardsWorkspace(props.request);
  useCardTutorOnCreated(ws.reload);

  const visibleQueue = useMemo(
    () => (deckFilter === '' ? ws.queue : ws.queue.filter((entry) => entry.card.deck === deckFilter)),
    [ws.queue, deckFilter],
  );
  const visibleCards = useMemo(
    () => (deckFilter === '' ? ws.cards : ws.cards.filter((c) => c.deck === deckFilter)),
    [ws.cards, deckFilter],
  );

  const dueTotal = ws.queue.length;
  const dueHere = visibleQueue.length;
  const masteredCount = Math.max(0, ws.cards.length - dueTotal);
  const currentItem = reviewing ? visibleQueue[position] : undefined;

  const startReview = useCallback(() => {
    setPosition(0);
    setRevealed(false);
    setReviewing(true);
    setSurface('review');
  }, []);

  const exitReview = useCallback(() => {
    setReviewing(false);
    setRevealed(false);
  }, []);

  const handleRate = useCallback(
    async (rating: (typeof RATING_ORDER)[number]) => {
      if (currentItem === undefined || ratingInFlight.current) return;
      ratingInFlight.current = true;
      try {
        const ok = await ws.rate(currentItem.card.cardId, rating);
        if (!ok) return;
        if (position + 1 >= visibleQueue.length) {
          exitReview();
          await ws.reload();
        } else {
          setPosition(position + 1);
          setRevealed(false);
        }
      } finally {
        ratingInFlight.current = false;
      }
    },
    [currentItem, position, visibleQueue.length, ws, exitReview],
  );

  // Keyboard-first review: Space flips, 1–4 rates, Esc exits.
  useEffect(() => {
    if (!reviewing || currentItem === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target !== null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.code === 'Space') {
        if (event.repeat) return;
        if (document.querySelector('[data-testid="card-selection-popover"]')) return;
        event.preventDefault();
        setRevealed((prev) => !prev);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        exitReview();
        return;
      }
      if (!revealed) return;
      const index = Number.parseInt(event.key, 10);
      const rating = RATING_ORDER[index - 1];
      if (index >= 1 && index <= 4 && rating !== undefined) {
        event.preventDefault();
        void handleRate(rating);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewing, currentItem, revealed, handleRate, exitReview]);

  const submitCreateCard = useCallback(async () => {
    if (newFront.trim() === '' || newBack.trim() === '') return;
    const input: FlashcardCreateInput = {
      model: 'basic',
      deck: newDeck.trim() !== '' ? newDeck.trim() : 'General',
      front: newFront.trim(),
      back: newBack.trim(),
    };
    const ok = await ws.create(input);
    if (ok) {
      setCreateOpen(false);
      setNewFront('');
      setNewBack('');
      setSurface('library');
      await ws.reload();
    }
  }, [newDeck, newFront, newBack, ws]);

  const submitGenerate = useCallback(() => {
    if (generateTopic.trim() === '') return;
    props.onSendToChat?.(`/doccards generate "${generateTopic.trim()}"`);
    props.onClose();
  }, [generateTopic, props]);

  const deleteCard = useCallback(
    async (cardId: string) => {
      const ok = await ws.remove(cardId);
      if (ok) await ws.reload();
    },
    [ws],
  );

  const openBrowse = useCallback((cardId: string) => {
    const cards = cardsForBrowse(visibleCards, cardId);
    if (cards.length === 0) return;
    setBrowse({
      cards,
      focusId: cardId,
      startIndex: browseStartIndex(cards, cardId),
    });
  }, [visibleCards]);

  const closeBrowse = useCallback(() => {
    if (browse) restoreBrowseFocusId.current = browse.focusId;
    setBrowse(null);
  }, [browse]);

  useEffect(() => {
    if (browse !== null) return;
    const focusId = restoreBrowseFocusId.current;
    if (!focusId) return;
    restoreBrowseFocusId.current = null;
    const focusTile = (): void => {
      document.querySelector<HTMLButtonElement>(`[data-testid="flashcard-open-${focusId}"]`)?.focus();
    };
    const frame = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(focusTile);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [browse]);

  const deleteBrowseCard = useCallback(
    async (cardId: string) => {
      const ok = await ws.remove(cardId);
      if (!ok) return;
      setBrowse(null);
      await ws.reload();
    },
    [ws],
  );

  const deleteBrowseSet = useCallback(async () => {
    if (!browse) return;
    const sequenceId = browse.cards.find((card) => card.sequenceId)?.sequenceId;
    const ids = sequenceId
      ? ws.cards.filter((card) => card.sequenceId === sequenceId).map((card) => card.id)
      : browse.cards.map((card) => card.id);
    await Promise.all(ids.map((id) => ws.remove(id)));
    setBrowse(null);
    await ws.reload();
  }, [browse, ws]);

  const deckOptions = useMemo(() => {
    const options = ws.decks.map((deck) => ({ value: deck, label: deck }));
    return options.length > 0 ? options : [{ value: 'General', label: 'General' }];
  }, [ws.decks]);

  return (
    <div className="fcws-stage" data-testid="flashcards-workspace">
      <header className="studio-topbar">
        <div className="studio-topbar-identity">
          <button
            type="button"
            className="studio-back-btn"
            data-testid="flashcards-back-btn"
            onClick={props.onClose}
          >
            <IconArrowLeft width={14} height={14} />
            <span>{t('Chat', '会话')}</span>
          </button>
          <div className="studio-title-badge fcws-title-badge">
            <IconCards width={15} height={15} />
          </div>
          <h1 className="studio-title">{t('Flashcards Studio', '闪卡记忆中心')}</h1>
        </div>
        <div className="studio-topbar-actions">
          <Button variant="secondary" size="compact" onClick={() => setGenerateOpen(true)}>
            <IconSpark width={13} height={13} />
            <span>{t('AI Generate', 'AI 生成')}</span>
          </Button>
          <Button variant="primary" size="compact" onClick={() => setCreateOpen(true)}>
            <IconPlus width={13} height={13} />
            <span>{t('Add Card', '新增卡片')}</span>
          </Button>
          <IconButton label={t('Close', '关闭')} title={t('Close', '关闭')} onClick={props.onClose}>
            <IconClose width={16} height={16} />
          </IconButton>
        </div>
      </header>

      <div className="studio-body">
        {/* ── Left rail: compact overview + decks ── */}
        <aside className="studio-rail">
          <section className="rail-section">
            <h2 className="rail-section-title">{t('Today', '今日概览')}</h2>
            <div className="fcws-overview">
              <div className={`fcws-overview-due${dueTotal > 0 ? ' is-active' : ''}`}>
                <span className="fcws-overview-num">{dueTotal}</span>
                <span className="fcws-overview-cap">{t('due now', '待复习')}</span>
              </div>
              <div className="fcws-overview-row">
                <span>{t('Cards', '卡片总数')}</span>
                <strong>{ws.cards.length}</strong>
              </div>
              <div className="fcws-overview-row">
                <span>{t('Mastered', '未到期')}</span>
                <strong>{masteredCount}</strong>
              </div>
            </div>
          </section>

          <section className="rail-section">
            <h2 className="rail-section-title">{t('Decks', '卡组')}</h2>
            <div className="fcws-deck-list">
              <button
                type="button"
                className={`fcws-deck-row${deckFilter === '' ? ' active' : ''}`}
                onClick={() => setDeckFilter('')}
              >
                <span>{t('All decks', '全部卡组')}</span>
                <span className="fcws-deck-count">{ws.cards.length}</span>
              </button>
              {ws.decks.map((deck) => {
                const count = ws.cards.filter((c) => c.deck === deck).length;
                const due = ws.queue.filter((q) => q.card.deck === deck).length;
                return (
                  <button
                    key={deck}
                    type="button"
                    className={`fcws-deck-row${deckFilter === deck ? ' active' : ''}`}
                    onClick={() => setDeckFilter(deck)}
                  >
                    <span className="fcws-deck-name">{deck}</span>
                    <span className="fcws-deck-meta">
                      {due > 0 && <em className="fcws-deck-due">{due}</em>}
                      <span className="fcws-deck-count">{count}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </aside>

        {/* ── Canvas: review stage / card library ── */}
        <main className="studio-canvas fcws-canvas">
          {ws.error !== null && (
            <Notice tone="error" testId="flashcards-error">
              {ws.error}
            </Notice>
          )}

          <div className="fcws-toolbar">
            <SegmentedControl
              size="xs"
              value={surface}
              onChange={(value) => {
                setSurface(value as 'review' | 'library');
                if (value !== 'review') exitReview();
                if (value !== 'library') setBrowse(null);
              }}
              data={[
                { value: 'review', label: t(`Review (${dueHere})`, `复习 (${dueHere})`) },
                { value: 'library', label: t(`Library (${visibleCards.length})`, `卡片库 (${visibleCards.length})`) },
              ]}
            />
            {deckFilter !== '' && (
              <button type="button" className="fcws-filter-chip" onClick={() => setDeckFilter('')}>
                {deckFilter}
                <IconClose width={11} height={11} />
              </button>
            )}
          </div>

          {surface === 'review' ? (
            <div className="fcws-review-surface" data-testid="flashcards-review-surface">
              {ws.loading ? (
                <div className="fcws-loading">
                  <Spinner label={t('Loading flashcards…', '正在加载闪卡…')} />
                </div>
              ) : reviewing && currentItem !== undefined ? (
                <ReviewStage
                  item={currentItem}
                  position={position}
                  total={visibleQueue.length}
                  revealed={revealed}
                  isNew={currentItem.isNew}
                  locale={props.locale === 'en' ? 'en' : 'zh-CN'}
                  labels={{
                    flipHint: t('Click or press Space to reveal', '点击或按空格查看答案'),
                    rateHint: t('Rate your recall with 1–4', '按 1–4 评价回忆'),
                    revealAnswer: t('Reveal answer (Space)', '查看答案 (空格)'),
                    exitReview: t('Exit review', '结束复习'),
                    answer: t('Answer', '答案解析'),
                    newBadge: t('New', '新卡'),
                    rateLabels: {
                      again: t('Again', '忘了'),
                      hard: t('Hard', '较难'),
                      good: t('Good', '记住了'),
                      easy: t('Easy', '简单'),
                    },
                  }}
                  onToggleReveal={() => setRevealed((prev) => !prev)}
                  onRate={(rating: ReviewRatingName) => void handleRate(rating)}
                  onExit={exitReview}
                />
              ) : dueHere > 0 ? (
                <div className="fcws-start-hero">
                  <div className="fcws-start-icon">
                    <IconFlame width={30} height={30} />
                  </div>
                  <h2>
                    {dueHere} {t('cards due for review', '张卡片等待复习')}
                  </h2>
                  <p>
                    {t(
                      'FSRS schedules each card at the moment you are about to forget it.',
                      'FSRS 算法会在你即将遗忘的时刻安排每张卡片。',
                    )}
                  </p>
                  <Button
                    variant="primary"
                    data-testid="flashcards-review-start"
                    onClick={startReview}
                  >
                    <IconFlame width={14} height={14} />
                    <span>{t('Start review', '开始复习')}</span>
                  </Button>
                </div>
              ) : (
                <EmptyState
                  title={t('All caught up!', '今日复习已全部完成！')}
                  description={t(
                    'No cards are due right now. Create new cards or browse your library.',
                    '当前没有到期的卡片。可以新增卡片或浏览卡片库。',
                  )}
                  visual={
                    <span className="fcws-empty-visual">
                      <IconCheckCircle width={26} height={26} />
                    </span>
                  }
                  action={
                    <div className="fcws-empty-actions">
                      <Button variant="secondary" size="compact" onClick={() => setSurface('library')}>
                        {t('Browse library', '浏览卡片库')}
                      </Button>
                      <Button variant="ghost" size="compact" onClick={() => setGenerateOpen(true)}>
                        <IconSpark width={13} height={13} />
                        <span>{t('AI generate', 'AI 生成')}</span>
                      </Button>
                    </div>
                  }
                />
              )}
            </div>
          ) : (
            <div className="fcws-library" data-testid="flashcards-library">
              {browse ? (
                <TearDeck
                  key={browse.focusId}
                  cards={browse.cards}
                  labels={tearDeckLabels(browseLocale)}
                  locale={browseLocale}
                  initialIndex={browse.startIndex}
                  onClose={closeBrowse}
                  onDeleteCard={(cardId) => void deleteBrowseCard(cardId)}
                  onDeleteSet={() => void deleteBrowseSet()}
                />
              ) : ws.loading ? (
                <div className="fcws-loading">
                  <Spinner label={t('Loading flashcards…', '正在加载闪卡…')} />
                </div>
              ) : visibleCards.length === 0 ? (
                <EmptyState
                  title={t('No flashcards yet', '暂无记忆闪卡')}
                  description={t(
                    'Add a card manually or let the AI extract knowledge points into cards.',
                    '手动新增一张卡片，或让 AI 从笔记中提炼知识点生成卡片。',
                  )}
                  action={
                    <Button variant="secondary" size="compact" onClick={() => setCreateOpen(true)}>
                      <IconPlus width={13} height={13} />
                      <span>{t('Add Card', '新增卡片')}</span>
                    </Button>
                  }
                />
              ) : (
                <ul className="fcws-card-list">
                  {visibleCards.map((card) => {
                    const dueEntry = ws.queue.find((q) => q.card.itemId === card.id);
                    return (
                      <li key={card.id} className="fcws-card-row" data-testid={`flashcard-row-${card.id}`}>
                        <button
                          type="button"
                          className="fcws-card-row-open"
                          data-testid={`flashcard-open-${card.id}`}
                          onClick={() => openBrowse(card.id)}
                        >
                          <span className="fcws-card-deck">{card.deck}</span>
                          <span className="fcws-card-front">{itemPreviewText(card)}</span>
                          <span className="fcws-card-back">{card.back ?? card.text ?? ''}</span>
                        </button>
                        <div className="fcws-card-row-side">
                          {dueEntry !== undefined ? (
                            <span className="fcws-state-badge is-due">{t('Due', '待复习')}</span>
                          ) : (
                            <span className="fcws-state-badge">{t('Scheduled', '已安排')}</span>
                          )}
                          <button
                            type="button"
                            className="fcws-card-delete"
                            aria-label={t('Delete card', '删除卡片')}
                            onClick={() => void deleteCard(card.id)}
                          >
                            <IconTrash width={13} height={13} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </main>
      </div>

      <CreateCardDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        deckOptions={deckOptions}
        deck={newDeck === '' ? deckOptions[0]?.value ?? 'General' : newDeck}
        onDeckChange={setNewDeck}
        front={newFront}
        onFrontChange={setNewFront}
        back={newBack}
        onBackChange={setNewBack}
        labels={{
          title: t('Create Flashcard', '新建记忆卡片'),
          deck: t('Deck', '所属卡组'),
          front: t('Front (question)', '正面（问题）'),
          frontPlaceholder: t('Enter the question…', '输入问题…'),
          back: t('Back (answer)', '背面（答案）'),
          backPlaceholder: t('Enter the answer…', '输入答案与解析…'),
          cancel: t('Cancel', '取消'),
          save: t('Save card', '保存卡片'),
        }}
        onSave={() => void submitCreateCard()}
      />

      <GenerateCardsDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        topic={generateTopic}
        onTopicChange={setGenerateTopic}
        labels={{
          title: t('AI Flashcard Generation', '智能批量生成闪卡'),
          hint: t(
            'Paste study notes or a topic. The agent extracts key points into Q&A and cloze cards inside the chat session.',
            '粘贴学习笔记或主题，智能体会在会话中提炼核心概念，生成问答与填空卡片。',
          ),
          topicLabel: t('Topic or source text', '主题或原文'),
          topicPlaceholder: t('e.g. Transformer attention mechanism…', '例如：Transformer 注意力机制原理…'),
          cancel: t('Cancel', '取消'),
          generate: t('Generate in chat', '在会话中生成'),
        }}
        onGenerate={submitGenerate}
      />
    </div>
  );
}

export type { FlashcardsRequester };
