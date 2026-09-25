import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { Dot, IconButton, ListRow, Pill, ScreenHeading, TopBar } from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { mapActivityRows } from '../host/host-bridge.js';


export function TasksPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedTasksPage hostCtx={hostCtx} />;
}

function ConnectedTasksPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const { running } = mapActivityRows({ items: host.activityItems, sessions: host.sessions, projects: host.projects });
  const children = host.sessions.filter((session) => session.kind === 'subagent' || session.parentSessionId === host.activeSessionId);
  const runningMain = host.activeRunId !== undefined;
  const stop = () => { if (host.activeRunId !== undefined) void host.handleAbort(); };
  const openSession = async (sessionId: string): Promise<void> => {
    await host.handleSelectSession(sessionId);
    dispatch({ type: 'navigate', route: 'chat' });
  };
  const statusLabel = (status: string | undefined): string => {
    if (status === 'running') return '工作中';
    if (status === 'failed') return '失败';
    if (status === 'cancelled') return '已取消';
    return '已完成';
  };
  return (
    <>
      <TopBar title="子代理与任务" subtitle="Host 实时编排" onBack={() => dispatch({ type: 'navigate', route: 'chat' })} right={<IconButton name="sliders" label="查看计划" onClick={() => dispatch({ type: 'open-sheet', key: 'plan-menu' })} />} />
      <div className="screen-scroll">
        <ScreenHeading title="远处的工作，看得见。" subtitle="只展示 Host 已确认的运行与子会话状态" />
        <div className="continue-card compact">
          <div className="spread"><span className="eyebrow">当前会话</span><Pill><Dot status={runningMain ? 'running' : 'done'} />{runningMain ? '执行中' : '空闲'}</Pill></div>
          <p>{host.activeSessionId === undefined ? '尚未选中会话。' : `会话 ${host.activeSessionId}`}</p>
          {runningMain ? <button className="full-button" onClick={stop} type="button">停止当前运行</button> : null}
          {!runningMain && running.length > 0 ? <p className="muted">另有 {running.length} 个 Host 会话正在运行。</p> : null}
        </div>
        <div className="section-label">活动子代理</div>
        {children.length === 0 ? <div className="notice-strip"><Dot status="done" /><span>Host 尚未报告子代理会话。</span></div> : null}
        {children.map((child) => (
          <article className="card" key={child.sessionId} style={{ marginBottom: 10 }}>
            <div className="spread"><Pill><Dot status={child.subagentStatus === 'running' ? 'running' : child.subagentStatus === 'failed' ? 'failed' : 'done'} />{statusLabel(child.subagentStatus)}</Pill><span className="mono muted" style={{ fontSize: 10 }}>{child.sessionId.slice(0, 12)}</span></div>
            <h3 className="card-title">{child.name?.trim() || child.task?.trim() || '未命名子代理'}</h3>
            <p>{child.task?.trim() || child.lastPreview?.trim() || 'Host 尚未返回任务描述。'}</p>
            <div className="card-foot"><span className="mono" style={{ fontSize: 11 }}>{child.subagentModel?.modelId ?? 'Host 模型'}</span><button className="text-link" onClick={() => void openSession(child.sessionId)} type="button">查看记录 <Icon name="chevr" /></button></div>
          </article>
        ))}
        <div className="section-label">实时活动</div>
        {running.length === 0 ? <div className="notice-strip"><Dot status="done" /><span>没有其他正在运行的 Host 会话。</span></div> : null}
        {running.map((row) => <ListRow key={row.sessionId} name="bulb" title={row.title} subtitle={row.subtitle} onClick={() => void openSession(row.sessionId)} />)}
      </div>
    </>
  );
}
