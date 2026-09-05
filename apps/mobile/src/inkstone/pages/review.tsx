import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { FullButton, IconButton, ListRow, Pill, ScreenHeading, TopBar } from '../inkstone-ui.js';

const DIFF_LINES: { className: string; line: number; code: string; commentable?: boolean }[] = [
  { className: '', line: 41, code: '  async restoreSession(id) {' },
  { className: 'remove', line: 42, code: '−   return createSession(id);' },
  {
    className: 'add commentable',
    line: 42,
    code: '+   const saved = await store.get(id);',
    commentable: true,
  },
  { className: 'add', line: 43, code: '+   if (!saved) return createSession(id);' },
  { className: 'add', line: 44, code: '+   return hydrateSession(saved);' },
  { className: '', line: 45, code: '  }' },
];

export function DiffCard(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <div className="diff-card">
      <div className="diff-heading">
        <span>session-index.ts</span>
        <span>
          <span className="green">+24</span> <span className="red">−6</span>
        </span>
      </div>
      <div className="diff-lines" aria-label="统一代码差异">
        {DIFF_LINES.map((entry, index) => (
          <div
            key={index}
            className={`diff-line ${entry.className}`.trim()}
            role={entry.commentable === true ? 'button' : undefined}
            tabIndex={entry.commentable === true ? 0 : undefined}
            onClick={
              entry.commentable === true
                ? () => dispatch({ type: 'open-sheet', key: 'comment' })
                : undefined
            }
            onKeyDown={
              entry.commentable === true
                ? (event) => {
                    if (event.key === 'Enter') dispatch({ type: 'open-sheet', key: 'comment' });
                  }
                : undefined
            }
            aria-label={entry.commentable === true ? `评论第${entry.line}行` : undefined}
          >
            <em>{entry.line}</em>
            {entry.code}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReviewPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="审阅变更"
        subtitle="piwin · 当前会话"
        onBack={go('chat')}
        right={<IconButton name="more" label="审阅选项" onClick={openSheet('review-options')} />}
      />
      <div className="screen-scroll">
        <ScreenHeading
          title={'看看这一轮，\n落下了哪些笔。'}
          subtitle="统一差异 · 点击新增行可留下意见"
        />
        <div className="diff-stats">
          <strong>3</strong>
          <span className="muted">个文件</span>
          <span className="green">+48</span>
          <span className="red">−12</span>
        </div>
        <ListRow
          name="file"
          title="session-index.ts"
          subtitle="会话恢复 · +24 −6"
          onClick={openSheet('file')}
          trailing="M"
        />
        <ListRow
          name="file"
          title="draft-store.ts"
          subtitle="草稿存储 · +18 −0"
          onClick={openSheet('file')}
          trailing="A"
        />
        <ListRow
          name="file"
          title="session-index.test.ts"
          subtitle="恢复路径测试 · +6 −6"
          onClick={openSheet('file')}
          trailing="M"
        />
        <DiffCard />
        {state.comment !== '' ? (
          <div className="quote-note">
            你的批注
            <br />
            {state.comment}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 11 }}>
            ↳ 点绿色新增行，写一条批注
          </p>
        )}
        <div className="section-label">
          验证结果 <Pill variant="pine">已通过</Pill>
        </div>
        <div className="command">
          ✓ session restore　8 tests
          <br />
          ✓ draft persistence　6 tests
          <br />✓ typecheck
        </div>
        <p className="muted" style={{ fontSize: 11 }}>
          以上为原型示例结果。
        </p>
      </div>
      <div className="bottom-action">
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'mark-reviewed' })}>
          {state.reviewDone ? '已标记看过 ✓' : '标记已看过'}
        </FullButton>
        <FullButton variant="subtle" onClick={go('chat')}>
          继续对话
        </FullButton>
      </div>
    </>
  );
}
