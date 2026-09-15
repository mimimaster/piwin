import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { FullButton, IconButton, ScreenHeading, TabsRow, TopBar } from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { FlashcardCatalogPage } from '../../surfaces/flashcards/FlashcardCatalogPage.js';
import { navigateMobileFlashcardsRoute } from '../../mobile-flashcards-route.js';

const CARD_QUESTIONS = [
  '为什么会话状态\n应该属于 Host？',
  '断线以后，\n草稿应该如何发送？',
  'Plan 与 Walkthrough\n有什么不同？',
];

const CARD_ANSWERS = [
  '因为桌面、手机和 CLI 需要读写同一份会话。Host 是执行与状态的唯一权威，设备只负责呈现与输入。',
  '先保留设备上的草稿。连接恢复后，先同步最新状态，再由用户确认发送，避免重复执行。',
  'Plan 是结构化的步骤与执行状态；Walkthrough 是与会话和消息绑定、面向用户的交付报告。',
];

const RATINGS: [string, string][] = [
  ['重来', 'Again'],
  ['较难', 'Hard'],
  ['记得', 'Good'],
  ['轻松', 'Easy'],
];

export function CardsPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedCardsPage hostCtx={hostCtx} />;
  }
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  const isReview = state.studyMode === 'review';
  const cardIndex = isReview ? state.studied : state.browsed;

  if (isReview && state.studied >= 12) {
    return (
      <>
        <TopBar title="知识卡片" onBack={go('shelf')} />
        <div className="screen-scroll">
          <div className="empty-state">
            <span className="brand-seal">砚</span>
            <h2>今天的十二张，读完了。</h2>
            <p>歇一会儿，让知识慢慢沉淀。</p>
          </div>
          <FullButton onClick={go('shelf')}>回到案头</FullButton>
          <FullButton variant="secondary" onClick={() => dispatch({ type: 'reset-study' })}>
            重新体验这轮复习
          </FullButton>
        </div>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="知识卡片"
        subtitle="piwin · 架构与设计"
        onBack={go('shelf')}
        right={<IconButton name="more" label="卡片选项" onClick={openSheet('card-options')} />}
      />
      <div className="screen-scroll">
        <ScreenHeading
          title={isReview ? '今日，读懂一点。' : '随便翻翻。'}
          subtitle={
            isReview
              ? `待复习 ${Math.max(0, 12 - state.studied)} 张 · 进度随 Host 同步`
              : '浏览模式 · 不写入复习评分'
          }
        />
        <TabsRow
          items={['计划复习', '随便看看']}
          selected={isReview ? '计划复习' : '随便看看'}
          onSelect={(value) => dispatch({ type: 'study-mode', value })}
        />
        <div className="section-label">
          <span>架构 · Host</span>
          <span className="mono">{String(cardIndex + 1).padStart(2, '0')} / 12</span>
        </div>
        <button
          className="flashcard"
          onClick={() => dispatch({ type: 'flip-card' })}
          aria-label={state.cardFlipped ? '查看问题' : '翻面查看答案'}
          type="button"
        >
          <span className="eyebrow">{state.cardFlipped ? 'ANSWER / 答案' : 'QUESTION / 问题'}</span>
          {state.cardFlipped ? (
            <p>{CARD_ANSWERS[cardIndex % 3]}</p>
          ) : (
            <h2 style={{ whiteSpace: 'pre-line' }}>{CARD_QUESTIONS[cardIndex % 3]}</h2>
          )}
          <span className="muted" style={{ fontSize: 11 }}>
            {state.cardFlipped ? '来自 docs/architecture.md' : '轻点纸面，翻看答案'} ↗
          </span>
        </button>
        {state.cardFlipped ? (
          isReview ? (
            <>
              <p className="muted" style={{ fontSize: 12, margin: '20px 0 12px' }}>
                这次记得怎么样？
              </p>
              <div className="rating-grid">
                {RATINGS.map(([label, english]) => (
                  <button
                    key={label}
                    onClick={() => dispatch({ type: 'rate-card', rating: label })}
                    type="button"
                  >
                    {label}
                    <small>{english}</small>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <FullButton variant="secondary" onClick={() => dispatch({ type: 'next-card' })}>
              下一张
            </FullButton>
          )
        ) : (
          <FullButton variant="secondary" onClick={() => dispatch({ type: 'flip-card' })}>
            翻看答案
          </FullButton>
        )}
        <div className="quote-note">
          {isReview
            ? '不用急着记住全部。每一次回想，都会留下新的痕迹。'
            : '只翻阅，不评分。遇到想再看的内容，可以留个记号。'}
        </div>
      </div>
    </>
  );
}

function ConnectedCardsPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  return (
    <FlashcardCatalogPage
      request={(command, options) => {
        if (client === undefined) {
          return Promise.resolve({
            type: 'response' as const,
            command: command.type,
            success: false as const,
            error: 'Host 尚未连接。',
          });
        }
        return client.request(command, options);
      }}
      connected={client !== undefined && host.connectionState.kind === 'ready'}
      hasStudyCapability={() => host.hostStatus?.capabilities.flashcardStudy === true}
      onOpenStudy={(roundId) => navigateMobileFlashcardsRoute({ kind: 'study', roundId }, 'push')}
      onBack={() => dispatch({ type: 'navigate', route: 'shelf' })}
    />
  );
}
