import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import {
  BottomNav,
  Dot,
  IconButton,
  Pill,
  ScreenHeading,
  TabsRow,
  TopBar,
  type DotStatus,
} from '../inkstone-ui.js';
import {
  collectPendingPermissionSessionIds,
  collectRunningSessionIds,
  mapSessionGroups,
  pickContinueSession,
  type InkstoneSessionRow,
} from '../host/host-bridge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';

export function inboxCount(permission: string, planApproved: boolean): number {
  return (permission === 'pending' ? 1 : 0) + (planApproved ? 0 : 1);
}

export function endpointLabel(endpoint: string | undefined): string {
  return (endpoint ?? '').replace(/^wss?:\/\//, '').replace(/\/$/, '') || '私有 Host';
}

export function applySessionFilter(
  rows: InkstoneSessionRow[],
  filter: string,
): InkstoneSessionRow[] {
  if (filter === '进行中') {
    return rows.filter((row) => row.status === 'running');
  }
  if (filter === '置顶') {
    return rows.filter((row) => row.pinned);
  }
  return rows;
}

export function hostConnectionSubtitle(host: InkstoneHostContextValue['host']): string {
  if (host.connectionState.kind === 'ready') {
    return '私有连接 · 与桌面同步';
  }
  if (host.connectionState.kind === 'connecting') {
    return '正在连接…';
  }
  return '连接已断开 · 点按管理';
}

export function SessionRows({ query = '' }: { query?: string }): ReactElement {
  const { state, dispatch } = useInkstone();
  const sessions: { title: string; subtitle: string; status: DotStatus; time: string }[] = [
    {
      title: state.currentTitle,
      subtitle: state.run === 'running' ? '正在整理会话索引' : '等待继续',
      status: state.run === 'running' ? 'running' : 'done',
      time: '刚刚',
    },
    {
      title: 'Inkstone · 桌面主题',
      subtitle: '设计稿已更新 · 4 个文件',
      status: 'done',
      time: '12 分钟',
    },
    {
      title: '修复移动端重连',
      subtitle: state.permission === 'pending' ? '等你批准 1 项操作' : '已处理权限请求',
      status: state.permission === 'pending' ? 'waiting' : 'done',
      time: '26 分钟',
    },
    {
      title: 'Host 的边界与职责',
      subtitle: '一份关于架构的讨论',
      status: 'background',
      time: '昨天',
    },
  ];
  const visible = sessions.filter(
    (session) =>
      session.title.toLowerCase().includes(query.toLowerCase()) &&
      (state.sessionFilter !== '进行中' || session.status === 'running') &&
      (state.sessionFilter !== '置顶' || session.title === state.currentTitle),
  );
  if (visible.length === 0) {
    return (
      <div className="empty-state">
        <h2>这一页还是空的</h2>
        <p>换个关键词，或开始一段新对话。</p>
      </div>
    );
  }
  return (
    <>
      {visible.map((session) => (
        <div className="session-item" key={session.title}>
          <Dot status={session.status} />
          <button
            className="session-open"
            onClick={() => dispatch({ type: 'open-session', title: session.title })}
            type="button"
          >
            <strong>
              {session.title}
              {state.pinned && session.title === state.currentTitle ? ' · 置顶' : ''}
            </strong>
            <small>
              {session.subtitle}
              <span>· {session.time}</span>
            </small>
          </button>
          <IconButton
            name="more"
            label={`${session.title}的更多操作`}
            onClick={() => dispatch({ type: 'open-sheet', key: 'session-menu' })}
          />
        </div>
      ))}
    </>
  );
}

function RealSessionRows({
  rows,
  hostCtx,
}: {
  rows: InkstoneSessionRow[];
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const openSession = (sessionId: string) => {
    void hostCtx.host.handleSelectSession(sessionId);
    dispatch({ type: 'navigate', route: 'chat' });
  };
  if (rows.length === 0) {
    return (
      <p className="muted" style={{ fontSize: 12, padding: '12px 0' }}>
        这里暂时没有会话。
      </p>
    );
  }
  return (
    <>
      {rows.map((row) => (
        <div className="session-item" key={row.sessionId}>
          <Dot status={row.status} />
          <button className="session-open" onClick={() => openSession(row.sessionId)} type="button">
            <strong>
              {row.title}
              {row.pinned ? ' · 置顶' : ''}
            </strong>
            <small>
              {row.subtitle}
              {row.time !== '' ? <span>· {row.time}</span> : null}
            </small>
          </button>
          <IconButton
            name="more"
            label={`${row.title}的更多操作`}
            onClick={() => {
              void hostCtx.host.handleSelectSession(row.sessionId);
              dispatch({ type: 'open-sheet', key: 'session-menu' });
            }}
          />
        </div>
      ))}
    </>
  );
}

function ConnectedSessions({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { state, dispatch } = useInkstone();
  const { host } = hostCtx;
  const now = Date.now();
  const running = collectRunningSessionIds(host.activityItems);
  const pending = collectPendingPermissionSessionIds(host.activityItems);
  const groups = mapSessionGroups({
    sessions: host.sessions,
    projects: host.projects,
    runningSessionIds: running,
    pendingPermissionSessionIds: pending,
    now,
  }).map((group) => ({ ...group, rows: applySessionFilter(group.rows, state.sessionFilter) }));
  const continueSession = pickContinueSession(host.sessions, running);
  const continueProject = host.projects.find(
    (project) => project.projectId === continueSession?.projectId,
  );
  const openSession = (sessionId: string) => {
    void host.handleSelectSession(sessionId);
    dispatch({ type: 'navigate', route: 'chat' });
  };
  return (
    <>
      <TopBar
        title="piwin"
        right={
          <>
            <IconButton
              name="search"
              label="搜索会话"
              onClick={() => dispatch({ type: 'open-sheet', key: 'search' })}
            />
            <IconButton
              name="plus"
              label="新建会话"
              onClick={() => dispatch({ type: 'navigate', route: 'new' })}
              extra="red-fill"
            />
          </>
        }
      />
      <div className="screen-scroll">
        <ScreenHeading title="会话" subtitle="九月五日，周六 · 思路仍在继续" />
        <button
          className="host-card"
          onClick={() => dispatch({ type: 'open-sheet', key: 'host' })}
          type="button"
        >
          <Dot status={host.connectionState.kind === 'ready' ? 'done' : 'waiting'} />
          <span className="grow">
            <strong>{endpointLabel(host.endpoint)}</strong>
            <small>{hostConnectionSubtitle(host)}</small>
          </span>
          <Icon name="chevd" />
        </button>
        {continueSession !== undefined ? (
          <div className="continue-card">
            <div className="spread">
              <span className="eyebrow">从桌面继续</span>
              <Pill>
                <Dot status={running.has(continueSession.sessionId) ? 'running' : 'done'} />
                {running.has(continueSession.sessionId) ? '工作中' : '等待继续'}
              </Pill>
            </div>
            <h3>{continueSession.name?.trim() || '未命名会话'}</h3>
            <p>
              {continueSession.lastPreview?.trim() || `${continueSession.messageCount ?? 0} 条消息`}
              <br />
              你离开后，工作仍在 Host 上继续。
            </p>
            <div className="spread continue-meta">
              <span className="mono">{continueProject?.displayName ?? '会话'}</span>
              <button onClick={() => openSession(continueSession.sessionId)} type="button">
                接着看 <Icon name="chevr" />
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <span className="brand-seal">砚</span>
            <h2>今天，想做点什么？</h2>
            <p>在 Host 上开始第一段会话。</p>
          </div>
        )}
        <TabsRow
          items={['全部', '进行中', '置顶']}
          selected={state.sessionFilter}
          onSelect={(value) => dispatch({ type: 'session-filter', value })}
        />
        {groups.map((group) => (
          <div key={group.projectId ?? '__general__'}>
            <div className="project-heading">
              <Icon name="folder" />
              <b>{group.project}</b>
              <small>{group.rows.length}</small>
            </div>
            <div className="session-tree">
              <RealSessionRows rows={group.rows} hostCtx={hostCtx} />
            </div>
          </div>
        ))}
        <button
          className="notice-strip"
          onClick={() => dispatch({ type: 'navigate', route: 'inbox' })}
          type="button"
        >
          <Icon name="bulb" />
          <span>
            {pending.size > 0 ? `有 ${pending.size} 件事，等你落笔。` : '今日待办已更新。'}
          </span>
          <Icon name="chevr" />
        </button>
      </div>
      <BottomNav
        selected="sessions"
        inboxCount={pending.size}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}

export function SessionsPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedSessions hostCtx={hostCtx} />;
  }
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <TopBar
        title="piwin"
        right={
          <>
            <IconButton name="search" label="搜索会话" onClick={openSheet('search')} />
            <IconButton name="plus" label="新建会话" onClick={go('new')} extra="red-fill" />
          </>
        }
      />
      <div className="screen-scroll">
        <ScreenHeading title="会话" subtitle="九月五日，周六 · 思路仍在继续" />
        <button className="host-card" onClick={openSheet('host')} type="button">
          <Dot status={state.offline ? 'waiting' : 'done'} />
          <span className="grow">
            <strong>书房的 Mac Studio</strong>
            <small>{state.offline ? '连接已断开 · 显示上次快照' : '私有连接 · 与桌面同步'}</small>
          </span>
          <Icon name="chevd" />
        </button>
        <div className="continue-card">
          <div className="spread">
            <span className="eyebrow">从桌面继续</span>
            <Pill>
              <Dot status="running" />
              工作中
            </Pill>
          </div>
          <h3>{state.currentTitle}</h3>
          <p>
            已梳理会话索引，正在补全恢复逻辑。
            <br />
            你离开后，Agent 又完成了 2 个步骤。
          </p>
          <div className="spread continue-meta">
            <span className="mono">piwin / main</span>
            <button
              onClick={() => dispatch({ type: 'open-session', title: state.currentTitle })}
              type="button"
            >
              接着看 <Icon name="chevr" />
            </button>
          </div>
        </div>
        <TabsRow
          items={['全部', '进行中', '置顶']}
          selected={state.sessionFilter}
          onSelect={(value) => dispatch({ type: 'session-filter', value })}
        />
        <div className="project-heading">
          <Icon name="folder" />
          <b>{state.selectedProject}</b>
          <small>4</small>
          <button onClick={openSheet('projects')} aria-label="切换项目" type="button">
            <Icon name="chevd" />
          </button>
        </div>
        <div className="session-tree">
          {state.archived ? (
            <p className="muted">当前会话已归档，可从设置恢复。</p>
          ) : (
            <SessionRows />
          )}
        </div>
        <div className="project-heading">
          <Icon name="folder" />
          <b>日常与灵感</b>
          <small>2</small>
        </div>
        <button
          className="list-row"
          onClick={() => dispatch({ type: 'open-session', title: '写给未来的自己' })}
          type="button"
        >
          <Icon name="file" />
          <span className="grow">
            <strong>写给未来的自己</strong>
            <small>今天 · 一段新的产品想法</small>
          </span>
          <span className="trailing">
            <Icon name="chevr" />
          </span>
        </button>
        <button className="notice-strip" onClick={go('inbox')} type="button">
          <Icon name="bulb" />
          <span>
            {state.permission === 'pending' ? '有 2 件事，等你落笔。' : '今日待办已更新。'}
          </span>
          <Icon name="chevr" />
        </button>
      </div>
      <BottomNav
        selected="sessions"
        inboxCount={inboxCount(state.permission, state.planApproved)}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}
