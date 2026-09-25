import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../inkstone-state.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { Icon } from '../icons.js';
import {
  BottomNav,
  Dot,
  FullButton,
  IconButton,
  ListRow,
  ScreenHeading,
  TopBar,
} from '../inkstone-ui.js';
import { cleanSessionPreview } from '../host/host-bridge.js';

export function ShelfPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedShelfPage hostCtx={hostCtx} />;
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
