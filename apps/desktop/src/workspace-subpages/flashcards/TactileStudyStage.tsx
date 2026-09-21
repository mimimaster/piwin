import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { FlashcardFace, TearDeckSurface } from '@piwin/ui-kit';
import type { FlashcardItem, ReviewRating } from '@piwin/contracts';
import { itemAnswerText, itemPreviewText } from '@piwin/flashcards/cloze';
import type { DesktopLocale } from '../../desktop-locale';
import { MarkdownView } from '../../MarkdownView';
import { flashcardStudyCopy } from './study/study-copy';
import { resolveStudyKeyboard, type StudyKeyboardTarget } from './study/study-keyboard';
import { StudyRateBar } from './study/study-rate-bar';

export type TactileStudyStageProps = {
  locale: DesktopLocale;
  selectedDeck: string;
  cards: readonly FlashcardItem[];
};

type PreviewCard = {
  deck: string;
  front: string;
  back: string;
  source?: string;
};

function sampleCards(zh: boolean): PreviewCard[] {
  const t = (en: string, cn: string) => (zh ? cn : en);
  return [
    {
      deck: t('Architecture Spec · File Bounds', '架构设计规范 · 单源文件限制'),
      front: t(
        'In the AGENTS.md guidelines, what specific line numbers are prescribed for the Hard cap and Proactive trigger of any single source file?',
        'AGENTS.md 规范中，对于任何单个源文件的代码行数硬限制（Hard cap）和主动拆分警戒线（Proactive trigger）分别由哪些具体数字规定？',
      ),
      back: t(
        '1. **Hard cap: 1000 lines**. No source file (`.ts` / `.tsx` / `.rs` / `.css`) may ever exceed this limit;\n\n2. **Proactive trigger: ~400 lines**. Plan the split by responsibility when approaching this threshold.',
        '1. **硬限制（Hard cap）：1000 行**。任何源文件（`.ts` / `.tsx` / `.rs` / `.css`）绝不可突破该上限；\n\n2. **主动警戒线（Proactive trigger）：约 400 行**。接近该行数时即须开始规划按职责解耦拆分。',
      ),
      source: 'docs/AGENTS.md §3.2 Reuse & file size',
    },
    {
      deck: t('Dual Mode Host · Architecture Boundary', 'Dual Mode Host · 架构边界'),
      front: t(
        'Why does apps/desktop strictly forbid direct import of @earendil-works/pi-* packages?',
        '为什么桌面前端（apps/desktop）绝对禁止直接 import @earendil-works/pi-* 原生依赖？',
      ),
      back: t(
        '1. **Strict one-way layering**. UI/apps only depend on public `@piwin/*` contracts;\n\n2. **Dual-mode portability**. `PiSdkAdapter` and `PiRpcAdapter` share the same backend abstraction.',
        '1. **单向向下依赖律**。UI 层仅允许依赖公开 contracts；\n\n2. **双模式同构**。PiSdk 与 PiRpc 实现完全相同的宿主抽象。',
      ),
      source: 'docs/AGENTS.md §1 Non-negotiable architecture rules',
    },
    {
      deck: t('LLM-Wiki · Knowledge Synthesis', 'LLM-Wiki · 生熟分离范式'),
      front: t(
        'In the Karpathy LLM-Wiki paradigm, what is the fundamental boundary between Raw Sources and Cooked Wiki?',
        '在 Karpathy LLM-Wiki 范式中，“生肉信源”与“熟肉维基”的职责边界如何划分？',
      ),
      back: t(
        '1. **Raw Sources**: immutable ground-truth documents and codebase slices;\n\n2. **Cooked Wiki**: AI-synthesized, deduplicated encyclopedia interconnected with `[[wikilinks]]`.',
        '1. **生肉信源**：保真不可变的代码库切片与原始文档，负责证据召回；\n\n2. **熟肉维基**：经 AI 交叉验证、综合沉淀的单一大脑百科，由双括号网状互联。',
      ),
      source: 'skills/llm-wiki/SKILL.md',
    },
  ];
}

function itemToPreview(card: FlashcardItem): PreviewCard {
  return {
    deck: card.deck || 'General',
    front: itemPreviewText(card),
    back: itemAnswerText(card),
  };
}

function markdown(text: string, locale: 'zh-CN' | 'en'): ReactNode {
  return (
    <MarkdownView
      text={text}
      renderingPhase="completed"
      showStreamingCaret={false}
      artifactInlineEnabled={false}
      locale={locale}
    />
  );
}

function keyboardTarget(value: EventTarget | null): StudyKeyboardTarget | null {
  if (!(value instanceof HTMLElement)) return null;
  return { tagName: value.tagName, isContentEditable: value.isContentEditable };
}

/** Local preview desk. Real due/deck review opens `FlashcardStudyRoute`. */
export function TactileStudyStage(props: TactileStudyStageProps): ReactElement {
  const locale = props.locale === 'en' ? 'en' : 'zh-CN';
  const copy = flashcardStudyCopy(locale);
  const samples = useMemo(() => sampleCards(locale === 'zh-CN'), [locale]);

  const queue = useMemo(() => {
    const filtered =
      props.selectedDeck === 'all'
        ? props.cards
        : props.cards.filter((card) => (card.deck || 'General') === props.selectedDeck);
    if (filtered.length > 0) return filtered.map(itemToPreview);
    return samples;
  }, [props.cards, props.selectedDeck, samples]);

  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const total = queue.length;
  const current = total === 0 ? null : queue[index % total];
  const currentPos = total === 0 ? 0 : (index % total) + 1;
  const progressPercent = total === 0 ? 0 : Math.round((currentPos / total) * 100);

  const flip = useCallback(() => {
    setRevealed((prev) => !prev);
  }, []);

  const rate = useCallback((_rating: ReviewRating) => {
    setRevealed(false);
    setIndex((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = resolveStudyKeyboard(
        {
          key: event.key,
          repeat: event.repeat,
          isComposing: event.isComposing,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          target: keyboardTarget(event.target),
        },
        { mode: 'scheduled', phase: revealed ? 'answer' : 'question', overlayOpen: false },
      );
      if (!action) return;
      event.preventDefault();
      if (action.type === 'flip') flip();
      if (action.type === 'rate') rate(action.rating);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flip, rate, revealed]);

  return (
    <div className="vault-study-page" id="subview-study" data-testid="flashcards-tactile-stage">
      <TearDeckSurface
        toolbar={
          <header className="fcws-tear-toolbar">
            <div className="fcws-tear-progress-wrap">
              <span className="fcws-tear-count" data-testid="flashcards-tear-count">
                {currentPos} / {total}
              </span>
              <div className="fcws-tear-progress-bar">
                <div className="fcws-tear-progress-fill" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
          </header>
        }
        current={
          current ? (
            <FlashcardFace
              revealed={revealed}
              deckName={current.deck}
              contentTestId={revealed ? 'flashcards-tear-back' : 'flashcards-tear-front'}
              onFlip={flip}
              content={markdown(revealed ? current.back : current.front, locale)}
              {...(current.source
                ? {
                    source: (
                      <div className="fcws-tear-source-line">
                        <span>{current.source}</span>
                      </div>
                    ),
                  }
                : {})}
            />
          ) : (
            <article className="fcws-tear-card">
              <h3>{copy.emptyTitle}</h3>
              <p>{copy.emptyBody}</p>
            </article>
          )
        }
        actions={
          <footer className="fcws-tear-actions fcws-study-rate-actions">
            <StudyRateBar copy={copy} disabled={!revealed} onRate={rate} />
          </footer>
        }
      />
    </div>
  );
}
