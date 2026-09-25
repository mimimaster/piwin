import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { IconButton, ListRow, ScreenHeading, TopBar } from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { endpointLabel } from './sessions.js';

export function WorkbenchPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedWorkbenchPage hostCtx={hostCtx} />;
}

function ConnectedWorkbenchPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const running = host.activityItems.filter((item) => item.status === 'running').length;
  const openChat = () => dispatch({ type: 'navigate', route: 'chat' });
  const openSession = async (sessionId: string): Promise<void> => {
    await host.handleSelectSession(sessionId);
    openChat();
  };
  return (
    <>
      <TopBar title="工作台" subtitle={`${endpointLabel(host.endpoint)} · Host 工具`} onBack={openChat} right={<IconButton name="plus" label="快捷操作" onClick={() => dispatch({ type: 'open-sheet', key: 'workspace-menu' })} />} />
      <div className="screen-scroll">
        <ScreenHeading title="工具只显示真实状态。" subtitle={host.connectionState.kind === 'ready' ? '执行与文件仍归 Host，手机负责呈现与发起请求。' : 'Host 尚未就绪，暂不展示缓存的假工具。'} />
        <div className="notice"><Icon name="panelr" /><b>{running} 个运行中的会话</b><span>{host.sessions.length} 个会话已同步</span></div>
        <div className="section-label">真实入口</div>
        <ListRow name="chat" title="当前会话" subtitle={host.activeSessionId ?? '未选择会话'} onClick={openChat} />
        <ListRow name="cards" title="计划与差异" subtitle="读取 Host 计划、执行状态与审阅入口" onClick={() => dispatch({ type: 'navigate', route: 'plan' })} />
        <ListRow name="fork" title="子代理与任务" subtitle={`${running} 个运行中的 Host 活动`} onClick={() => dispatch({ type: 'navigate', route: 'tasks' })} />
        <ListRow name="book" title="知识库" subtitle={`${host.knowledgeBases.length} 个 Host 信源`} onClick={() => dispatch({ type: 'navigate', route: 'knowledge' })} />
        <div className="section-label">会话工具</div>
        {host.sessions.slice(0, 8).map((session) => (
          <ListRow key={session.sessionId} name="panel" title={session.name?.trim() || '未命名会话'} subtitle={`${session.messageCount ?? 0} 条消息`} onClick={() => void openSession(session.sessionId)} />
        ))}
        {host.sessions.length === 0 ? <div className="empty-state"><p>Host 尚未返回会话，连接恢复后会自动刷新。</p></div> : null}
      </div>
    </>
  );
}
