import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { Icon, type InkstoneIconName } from '../icons.js';
import {
  BottomNav,
  Dot,
  FullButton,
  IconButton,
  ListRow,
  ScreenHeading,
  TopBar,
} from '../inkstone-ui.js';
import { inboxCount } from './sessions.js';
import { cleanSessionPreview } from '../host/host-bridge.js';

const SHELF_TILES: [InkstoneIconName, string, string, InkstoneRoute][] = [
  ['image', '资料库', '图片 · 视频 · 收藏', 'library'],
  ['cards', '知识卡片', '12 张待复习', 'cards'],
  ['refresh', '自动化', '2 条定时任务', 'automations'],
  ['gear', '设置', '模型 · 权限 · 扩展', 'settings'],
];

export function ShelfPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedShelfPage hostCtx={hostCtx} />;
  }
  const { state, dispatch } = useInkstone();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="案头"
        right={<IconButton name="gear" label="打开设置" onClick={go('settings')} />}
      />
      <div className="screen-scroll">
        <ScreenHeading title="一方小案头。" subtitle="收下成果，也留住灵感。" />
        <button className="host-card" onClick={openSheet('host')} type="button">
          <span className="host-monogram">书</span>
          <span className="grow">
            <strong>书房的 Mac Studio</strong>
            <small>{state.offline ? '连接已断开' : '已连接 · 2 台设备在线'}</small>
          </span>
          <Dot status={state.offline ? 'waiting' : 'done'} />
        </button>
        <div className="shelf-grid">
          {SHELF_TILES.map(([name, title, subtitle, route]) => (
            <button className="shelf-tile" key={title} onClick={go(route)} type="button">
              <Icon name={name} />
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </button>
          ))}
        </div>
        <div className="section-label">最近留在案头</div>
        <ListRow
          name="file"
          title="Inkstone 设计走查"
          subtitle="报告 · 今天 09:18"
          onClick={go('walkthrough')}
        />
        <ListRow
          name="cards"
          title="Host 的边界"
          subtitle="知识卡片 · 今天"
          onClick={go('cards')}
        />
        <ListRow
          name="file"
          title="移动端的三点想法"
          subtitle="笔记 · 昨天"
          onClick={() => dispatch({ type: 'open-workspace', tab: '笔记' })}
        />
        <div className="section-label">随手记</div>
        <FullButton variant="secondary" onClick={openSheet('dictation')}>
          <Icon name="mic" /> 说一句，留在当前会话
        </FullButton>
      </div>
      <BottomNav
        selected="shelf"
        inboxCount={inboxCount(state.permission, state.planApproved)}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}

function ConnectedShelfPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const connectionLabel =
    host.connectionState.kind === 'ready'
      ? '已连接 · Host 实时同步'
      : host.connectionState.kind === 'connecting'
        ? '正在连接…'
        : '连接不可用';
  const activeSession = host.sessions.find((session) => session.sessionId === host.activeSessionId);
  const pendingCount = host.activityItems.filter((item) => item.pendingPermission).length;
  const openSession = async (sessionId: string): Promise<void> => {
    await host.handleSelectSession(sessionId);
    dispatch({ type: 'navigate', route: 'chat' });
  };
  return (
    <>
      <TopBar title="案头" right={<IconButton name="gear" label="打开设置" onClick={() => dispatch({ type: 'navigate', route: 'settings' })} />} />
      <div className="screen-scroll">
        <ScreenHeading title="Host 案头" subtitle="只展示已从 Host 同步的内容" />
        <button className="host-card" onClick={() => dispatch({ type: 'open-sheet', key: 'host' })} type="button">
          <span className="host-monogram">书</span>
          <span className="grow">
            <strong>{host.endpoint}</strong>
            <small>{connectionLabel}</small>
          </span>
          <Dot status={host.connectionState.kind === 'ready' ? 'done' : 'waiting'} />
        </button>
        <div className="shelf-grid">
          <button className="shelf-tile" onClick={() => dispatch({ type: 'navigate', route: 'library' })} type="button">
            <Icon name="image" />
            <strong>资料库</strong>
            <small>Host 媒体与附件</small>
          </button>
          <button className="shelf-tile" onClick={() => dispatch({ type: 'navigate', route: 'cards' })} type="button">
            <Icon name="cards" />
            <strong>知识卡片</strong>
            <small>Host 目录与复习</small>
          </button>
          <button className="shelf-tile" onClick={() => dispatch({ type: 'navigate', route: 'automations' })} type="button">
            <Icon name="refresh" />
            <strong>自动化</strong>
            <small>查看 Host 状态</small>
          </button>
          <button className="shelf-tile" onClick={() => dispatch({ type: 'navigate', route: 'settings' })} type="button">
            <Icon name="gear" />
            <strong>设置</strong>
            <small>Host 配置与权限</small>
          </button>
        </div>
        <div className="section-label">最近会话</div>
        {host.sessions.slice(0, 6).map((session) => (
          <ListRow
            key={session.sessionId}
            name="file"
            title={session.name?.trim() || '未命名会话'}
            subtitle={cleanSessionPreview(session.lastPreview) || `${session.messageCount ?? 0} 条消息`}
            onClick={() => void openSession(session.sessionId)}
          />
        ))}
        {host.sessions.length === 0 ? <p className="muted">Host 尚未返回会话。</p> : null}
        {activeSession !== undefined ? (
          <FullButton variant="secondary" onClick={() => void openSession(activeSession.sessionId)}>
            继续当前会话
          </FullButton>
        ) : null}
      </div>
      <BottomNav
        selected="shelf"
        inboxCount={pendingCount}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}
