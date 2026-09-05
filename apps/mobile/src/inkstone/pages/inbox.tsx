import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import {
  BottomNav,
  Dot,
  IconButton,
  ListRow,
  Pill,
  ScreenHeading,
  TabsRow,
  TopBar,
} from '../inkstone-ui.js';
import { inboxCount } from './sessions.js';

function PermissionGate(): ReactElement {
  const { state, dispatch } = useInkstone();
  const decide = (choice: 'approved' | 'denied') => () =>
    dispatch({ type: 'permission', choice, scope: 'once' });
  return (
    <article className="gate">
      <div className="spread">
        <Pill variant="zhu">
          <Dot status="waiting" />
          等待批准
        </Pill>
        <span className="muted" style={{ fontSize: 10 }}>
          2 分钟前
        </span>
      </div>
      <h3>修复移动端重连</h3>
      <p>Agent 需要执行测试，验证断线后的会话恢复。</p>
      <pre className="command">pnpm --filter @piwin/host-client test</pre>
      <dl className="facts">
        <dt>工作目录</dt>
        <dd className="mono">~/Developer/piwin</dd>
        <dt>作用范围</dt>
        <dd>仅本次命令 · Host 执行</dd>
      </dl>
      <Pill onClick={() => dispatch({ type: 'open-sheet', key: 'permission' })}>
        查看完整请求 <Icon name="chevr" />
      </Pill>
      <div className="gate-footer">
        <span>{state.offline ? '已断线，请先恢复连接' : '读过之后，再落印。'}</span>
        <button
          className="seal-button ghost"
          onClick={decide('denied')}
          disabled={state.offline}
          aria-label="拒绝本次操作"
          type="button"
        >
          否
        </button>
        <button
          className="seal-button"
          onClick={decide('approved')}
          disabled={state.offline}
          aria-label="允许本次操作"
          type="button"
        >
          允
        </button>
      </div>
    </article>
  );
}

export function InboxPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="待办"
        right={
          <IconButton name="sliders" label="待办通知偏好" onClick={openSheet('notifications')} />
        }
      />
      <div className="screen-scroll">
        <ScreenHeading title="等你，一方印。" subtitle="需要决定的先来，其他的慢慢看。" />
        <TabsRow
          items={['待处理', '进行中', '已完成']}
          selected={state.inboxFilter}
          onSelect={(value) => dispatch({ type: 'inbox-filter', value })}
        />
        {state.inboxFilter === '待处理' ? (
          <>
            {state.permission === 'pending' ? (
              <PermissionGate />
            ) : (
              <div className="notice-strip">
                <Dot status="done" />
                <span>已{state.permission === 'approved' ? '允许' : '拒绝'}本次请求</span>
                <button onClick={() => dispatch({ type: 'reset-permission' })} type="button">
                  重演
                </button>
              </div>
            )}
            <div className="section-label">下一件事</div>
            <ListRow
              name="cards"
              title="计划已经写好"
              subtitle="会话记忆 · 4 个步骤，等待选择执行方式"
              onClick={openSheet('execute-plan')}
              trailing={state.planApproved ? '已执行' : '待确认'}
            />
          </>
        ) : state.inboxFilter === '进行中' ? (
          <>
            <ListRow
              name="bulb"
              title="让会话拥有记忆"
              subtitle="正在整理恢复逻辑 · piwin"
              onClick={go('chat')}
            />
            <ListRow
              name="fork"
              title="补全恢复路径测试"
              subtitle="子代理工作中 · 1 分 32 秒"
              onClick={openSheet('subagent')}
            />
          </>
        ) : (
          <>
            <ListRow
              name="git"
              title="Inkstone · 桌面主题"
              subtitle="4 个文件 · 检查完成"
              onClick={go('walkthrough')}
            />
            <ListRow
              name="file"
              title="Host 会话梳理"
              subtitle="交付报告可阅读 · 昨天"
              onClick={go('walkthrough')}
            />
          </>
        )}
        <div className="section-label">
          最近完成 <span className="mono">09:18</span>
        </div>
        <ListRow
          name="file"
          title="一份新的走查报告"
          subtitle="Inkstone · 桌面主题"
          onClick={go('walkthrough')}
        />
      </div>
      <BottomNav
        selected="inbox"
        inboxCount={inboxCount(state.permission, state.planApproved)}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}
