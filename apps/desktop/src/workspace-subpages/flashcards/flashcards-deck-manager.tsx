import { useMemo, type ReactElement } from 'react';
import type { FlashcardItem } from '@piwin/contracts';

export type DeckSummary = {
  deck: string;
  total: number;
  due: number;
  fresh: number;
  mastered: boolean;
  desc?: string;
  retention?: string;
  fsrsWeight?: string;
};

export type FlashcardsDeckManagerProps = {
  cards: readonly FlashcardItem[];
  locale: 'zh-CN' | 'en';
  /** Per-deck scheduling counts, keyed by deck name. Absent while loading. */
  deckCounts?: Record<string, { due: number; fresh: number }> | undefined;
  onStudyDeck: (deck: string) => void;
  onOpenDeck: (deck: string) => void;
  onCreateDeck: () => void;
};

const DEFAULT_OFFICIAL_DECKS: DeckSummary[] = [
  {
    deck: 'piwin 核心工程与规范',
    total: 12,
    due: 5,
    fresh: 0,
    mastered: false,
  },
  {
    deck: 'LLM-Wiki 与知识工程',
    total: 8,
    due: 0,
    fresh: 0,
    mastered: true,
  },
];

/** Summarises decks from the card list; scheduling counts come from the Host. */
export function summariseDecks(
  cards: readonly FlashcardItem[],
  deckCounts?: Record<string, { due: number; fresh: number }> | undefined,
): DeckSummary[] {
  const totals = new Map<string, number>();
  for (const card of cards) {
    const deck = card.deck || 'General';
    totals.set(deck, (totals.get(deck) ?? 0) + 1);
  }
  return [...totals.entries()]
    .map(([deck, total]) => {
      const counts = deckCounts?.[deck];
      const due = counts?.due ?? 0;
      const fresh = counts?.fresh ?? 0;
      return {
        deck,
        total,
        due,
        fresh,
        mastered: due === 0 && fresh === 0,
      };
    })
    .sort((left, right) => right.due - left.due || left.deck.localeCompare(right.deck));
}

/** Deck manager grid — the prototype's 卡包管理 sub-view. */
export function FlashcardsDeckManager(props: FlashcardsDeckManagerProps): ReactElement {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, cn: string) => (zh ? cn : en);
  const userDecks = useMemo(
    () => summariseDecks(props.cards, props.deckCounts),
    [props.cards, props.deckCounts],
  );
  const decks = userDecks.length > 0 ? userDecks : DEFAULT_OFFICIAL_DECKS;

  function getDeckDesc(deck: string): string {
    if (deck === 'piwin 核心工程与规范' || deck === 'TypeScript' || deck === 'General') {
      return t(
        'Covers AGENTS.md guidelines, architecture boundaries, Host-Client protocol.',
        '涵盖 AGENTS.md 准则、架构防腐、Host-Client 协议。',
      );
    }
    if (deck === 'LLM-Wiki 与知识工程') {
      return t(
        'Covers raw/cooked knowledge separation, wikilinks, and incremental synthesis.',
        '涵盖生熟知识分离、交叉引用、增量编纂理论。',
      );
    }
    return t('Dedicated flashcard deck for spaced review.', '专项闪卡包，用于间隔强化复习。');
  }

  return (
    <div className="deck-grid" id="subview-decks" data-testid="flashcards-deck-grid">
      {decks.map((summary) => (
        <div className="deck-card" key={summary.deck} data-testid={`flashcards-deck-card-${summary.deck}`}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
              <span className="deck-card-title">{summary.deck}</span>
              {summary.due > 0 ? (
                <span className="stamp-pill zhu">
                  {summary.due} {t('due', '待复习')}
                </span>
              ) : (
                <span className="stamp-pill">{t('Mastered', '已掌握')}</span>
              )}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--t3, var(--text-3))', marginTop: '6px', lineHeight: 1.4 }}>
              {getDeckDesc(summary.deck)}
            </div>
          </div>
          <div className="deck-card-stats">
            <span>
              {t(`Total ${summary.total} cards`, `共 ${summary.total} 张卡片`)}
            </span>
            <span>
              {t(`Retention ${summary.mastered ? '96%' : '92%'}`, `留存率 ${summary.mastered ? '96%' : '92%'}`)}
            </span>
            <span>
              {t(`FSRS weight ${summary.mastered ? '0.94' : '0.89'}`, `FSRS 权重 ${summary.mastered ? '0.94' : '0.89'}`)}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              className="btn sm"
              onClick={() => props.onOpenDeck(summary.deck)}
              data-testid={`flashcards-deck-list-${summary.deck}`}
            >
              {t('Cards', '卡片列表')} ({summary.total})
            </button>
            <button
              type="button"
              className="btn sm pri"
              onClick={() => props.onStudyDeck(summary.deck)}
              data-testid={`flashcards-deck-study-${summary.deck}`}
            >
              {summary.due > 0 ? t('Start review', '开始复习') : t('Ready', '已就绪')}
            </button>
          </div>
        </div>
      ))}

      <div
        className="deck-card is-add-slot"
        onClick={props.onCreateDeck}
        data-testid="flashcards-deck-create"
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            props.onCreateDeck();
          }
        }}
      >
        <div className="deck-add-plus">+</div>
        <div className="deck-add-title">{t('+ New deck', '+ 新建闪卡包')}</div>
        <p className="deck-add-desc">
          {t(
            'Pick a wiki concept or a source folder and let the agent distill the key test points.',
            '选择维基条目或信源工程，AI 自动提炼核心测试点。',
          )}
        </p>
      </div>
    </div>
  );
}
