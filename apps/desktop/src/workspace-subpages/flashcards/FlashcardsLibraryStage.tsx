import type { ReactElement } from 'react';
import { Button, Notice, Spinner } from '@piwin/ui-kit';
import { IconCards, IconPlus, IconSearch, IconSpark } from '../../shell-icons';
import type { DesktopLocale } from '../../desktop-locale';
import { FlashcardGallery } from './flashcard-gallery';
import type { FlashcardTileItem } from './group-flashcard-tiles';
import { flashcardStudyCopy } from './study/study-copy';

export type FlashcardsLibraryStageProps = {
  locale: DesktopLocale;
  search: string;
  onSearchChange: (search: string) => void;
  selectedDeck: string;
  onSelectDeck: (deck: string) => void;
  availableDecks: readonly string[];
  deckCounts: Record<string, number>;
  totalCardsCount: number;
  dueCount: number;
  newCount: number;
  hostTooOld: boolean;
  error: string | null;
  loading: boolean;
  tiles: readonly FlashcardTileItem[];
  onOpenTile: (tileId: string) => void;
  onDeleteTile: (tileId: string) => void;
  onStudyDue: () => void;
  onGoToDocuments?: (() => void) | undefined;
  onGoToWiki?: (() => void) | undefined;
  onCreateCard: () => void;
  onStartSampleStudy?: () => void;
};

export function FlashcardsLibraryStage(props: FlashcardsLibraryStageProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const studyCopy = flashcardStudyCopy(props.locale);

  if (props.loading) {
    return (
      <div className="flashcards-library-stage" data-testid="flashcards-library-stage">
        <div className="vault-empty" style={{ padding: '60px 20px' }}>
          <Spinner label={t('Loading flashcards…', '正在加载闪卡…')} />
        </div>
      </div>
    );
  }

  // Zero-Card Cold Start: Distillation Studio Bento Cards
  if (props.totalCardsCount === 0 && !props.search) {
    return (
      <div className="flashcards-library-stage" data-testid="flashcards-library-stage">
        <div className="cold-start-stage" data-testid="flashcards-distill-studio">
          {props.error !== null && (
            <Notice tone="error" testId="flashcards-error">
              {props.error}
            </Notice>
          )}

          <div className="cold-start-hero">
            <span className="cold-start-tag">{t('Three-tier Flywheel · Spaced Repetition', '三阶闭环 · 间隔强化')}</span>
            <h2 className="cold-start-title">{t('Distill Knowledge Essence · Activate Spaced Retention', '提炼知识精粹 · 激活间隔强化记忆')}</h2>
            <p className="cold-start-desc">
              {t(
                'Raw sources and cooked wikis are not the end of learning. Using the FSRS spaced repetition algorithm, core logic, architecture bounds, and design patterns are distilled into 3D tactile flashcards for reflexive recall.',
                '信源素材与维基百科并非记忆的终点。基于 FSRS 自由间隔重复算法，将核心逻辑、规范红线与设计模式转化为双面闪卡，经由每日复习内化为下意识反应。',
              )}
            </p>
          </div>

          {/* 3 Distillation Pathways Bento */}
          <div className="distill-pathway-grid">
            {/* Pathway 1: From LLM-Wiki */}
            <div
              className="pathway-card"
              onClick={props.onGoToWiki ?? props.onGoToDocuments}
              role="button"
              tabIndex={0}
              data-testid="flashcards-pathway-wiki"
            >
              <div>
                <span className="pathway-icon-chip">{t('Wiki Distillation', '维基条目提炼')}</span>
                <div className="pathway-title">{t('Distill from LLM-Wiki Concepts', '从 LLM-Wiki 概念出卡')}</div>
                <div className="pathway-desc">
                  {t(
                    'Distill core test points, constraints, and contrast questions from finalized wiki entries.',
                    '针对已定稿的维基概念（如 [[Dual Mode Host]]、[[AGENTS.md]]），自动提炼对比问答与核心约束。',
                  )}
                </div>
              </div>
              <div className="pathway-action">
                <span>{t('Browse wiki concepts', '浏览已收录词条出卡')}</span>
                <span>→</span>
              </div>
            </div>

            {/* Pathway 2: From Source Documents */}
            <div
              className="pathway-card"
              onClick={props.onGoToDocuments}
              role="button"
              tabIndex={0}
              data-testid="flashcards-goto-docs"
            >
              <div>
                <span className="pathway-icon-chip">{t('Source Engineering', '信源工程出卡')}</span>
                <div className="pathway-title">{t('Distill directly from Source Docs', '从信源资料直接提炼')}</div>
                <div className="pathway-desc">
                  {t(
                    'Pick imported repository code, technical specifications, or markdown notes to extract key logic snippets.',
                    '选择本地接入的项目代码仓库、技术文档或需求规范，AI 快速提取关键逻辑片段与核心测试点。',
                  )}
                </div>
              </div>
              <div className="pathway-action">
                <span>{t('Produce cards from docs', '从文档出卡')}</span>
                <span>→</span>
              </div>
            </div>

            {/* Pathway 3: Manual Card */}
            <div
              className="pathway-card"
              onClick={props.onCreateCard}
              role="button"
              tabIndex={0}
              data-testid="flashcards-pathway-manual"
            >
              <div>
                <span className="pathway-icon-chip">{t('Single Card', '独立卡片')}</span>
                <div className="pathway-title">{t('Manually Create Flashcard', '手动录入单张闪卡')}</div>
                <div className="pathway-desc">
                  {t(
                    'Handcraft classic two-sided question-and-answer cards and assign them to dedicated decks.',
                    '手写经典双面问答卡片，指定归属卡包，适合随手记录灵感与关键设计决策。',
                  )}
                </div>
              </div>
              <div className="pathway-action">
                <span>{t('+ Add new card', '+ 新增卡片')}</span>
                <span>+</span>
              </div>
            </div>
          </div>

          {/* Instant Try Sample Deck Callout */}
          <div className="sample-pack-callout">
            <div className="sample-pack-info">
              <div className="sample-pack-title">
                {t('Instant Preview: Built-in Official "piwin Core Engineering & Guidelines" Deck', '快速体验：载入官方《piwin 核心工程与规范》内置示例卡包')}
              </div>
              <div className="sample-pack-desc">
                {t(
                  'Includes 3D cards covering single-source 1000-line bounds, Dual Mode Host isolation, and LLM-Wiki separation. Experience 3D card flipping and FSRS rating right away.',
                  '内置单源文件 1000 行硬限制、Dual Mode 适配器边界、LLM-Wiki 生熟分离等规范闪卡，无需先导入文档即可体验 3D 翻转与评分仪式。',
                )}
              </div>
            </div>
            <button
              type="button"
              className="btn pri"
              onClick={props.onStartSampleStudy}
              data-testid="flashcards-try-sample-deck"
            >
              {t('Start Sample Review →', '一键载入并开始复习 →')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Active State: Toolbar and Tiled Gallery
  const deckFilters =
    props.availableDecks.length > 0 ? (
      <div className="vault-chips" role="group" aria-label={t('Deck', '卡组')} data-testid="flashcards-deck-chips">
        <button
          type="button"
          className={`vault-chip${props.selectedDeck === 'all' ? ' is-on' : ''}`}
          aria-pressed={props.selectedDeck === 'all'}
          onClick={() => props.onSelectDeck('all')}
        >
          <span>{t('All', '全部')}</span>
          <span className="vault-chip-count">{props.totalCardsCount}</span>
        </button>
        {props.availableDecks.map((deck) => (
          <button
            key={deck}
            type="button"
            className={`vault-chip${props.selectedDeck === deck ? ' is-on' : ''}`}
            data-testid={`flashcards-deck-${deck}`}
            aria-pressed={props.selectedDeck === deck}
            onClick={() => props.onSelectDeck(deck)}
          >
            <span>{deck}</span>
            <span className="vault-chip-count">{props.deckCounts[deck] ?? 0}</span>
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className="flashcards-library-stage" data-testid="flashcards-library-stage">
      <div
        className="flashcards-study-toolbar"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          gap: '12px',
        }}
      >
        <div
          className="vault-filters"
          style={{ display: 'flex', alignItems: 'center', gap: '12px' }}
        >
          <label className="vault-search">
            <IconSearch width={14} height={14} aria-hidden="true" />
            <span className="sr-only">{t('Search cards…', '搜索闪卡…')}</span>
            <input
              type="search"
              aria-label={t('Search cards…', '搜索闪卡…')}
              placeholder={t('Search cards…', '搜索闪卡…')}
              value={props.search}
              onChange={(e) => props.onSearchChange(e.target.value)}
              data-testid="flashcards-search-input"
            />
          </label>
          {deckFilters}
        </div>
        <div className="vault-bar-tools" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Button
            variant="secondary"
            size="compact"
            data-testid="flashcards-study-due"
            onClick={props.onStudyDue}
          >
            <span>{studyCopy.due}</span>
            {props.dueCount > 0 ? (
              <span className="vault-chip-count" style={{ marginLeft: 4 }}>{studyCopy.dueDue(props.dueCount)}</span>
            ) : null}
            {props.newCount > 0 ? (
              <span className="vault-chip-count" style={{ marginLeft: 4 }}>{studyCopy.dueNew(props.newCount)}</span>
            ) : null}
          </Button>
          {props.onGoToDocuments ? (
            <Button variant="secondary" size="compact" onClick={props.onGoToDocuments} data-testid="flashcards-goto-docs">
              <IconSpark width={13} height={13} aria-hidden="true" />
              <span>{t('Produce from docs', '从文档出卡')}</span>
            </Button>
          ) : null}
          <Button variant="primary" size="compact" onClick={props.onCreateCard}>
            <IconPlus width={13} height={13} aria-hidden="true" />
            <span>{t('Add card', '新增')}</span>
          </Button>
        </div>
      </div>

      <div className="flashcards-study-content" style={{ padding: '0 16px' }}>
        {props.error !== null && (
          <Notice tone="error" testId="flashcards-error">
            {props.error}
          </Notice>
        )}
        {props.hostTooOld ? (
          <Notice tone="warning" testId="flashcards-study-host-old">
            {studyCopy.hostTooOld}
          </Notice>
        ) : null}

        {props.tiles.length === 0 ? (
          <div className="vault-empty" style={{ padding: '48px 20px' }}>
            <IconCards width={24} height={24} aria-hidden="true" />
            <p style={{ marginTop: '8px', color: 'var(--t3)' }}>
              {t('No flashcards match the current filter.', '没有匹配当前筛选条件的闪卡。')}
            </p>
            {props.search ? (
              <Button
                variant="secondary"
                size="compact"
                style={{ marginTop: '12px' }}
                onClick={() => props.onSearchChange('')}
              >
                {t('Clear search', '清空搜索词')}
              </Button>
            ) : null}
          </div>
        ) : (
          <FlashcardGallery
            tiles={props.tiles}
            onOpen={props.onOpenTile}
            onDeleteTile={(tile) => props.onDeleteTile(tile.id)}
            labels={{
              delete: t('Delete tile', '删除此项'),
              openSet: t('Study set →', '过一遍 →'),
              openOne: t('Study →', '过一遍 →'),
              flipToAnswer: t('Show answer', '看答案'),
              flipToQuestion: t('Show question', '看问题'),
              answerFace: t('Answer', '答案'),
            }}
          />
        )}
      </div>
    </div>
  );
}
