import type { ReactElement } from 'react';
import { navTabForRoute, useWideLayout } from '../use-wide-layout.js';
import { NeedsHost } from '../needs-host.js';
import { useSessionListWindow } from '../../hooks/mobile-session-list.js';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../inkstone-state.js';
import { Icon } from '../icons.js';
import {
  BottomNav,
  Dot,
  IconButton,
  Pill,
  ScreenHeading,
  TabsRow,
  TopBar,
} from '../inkstone-ui.js';
import {
  collectPendingPermissionSessionIds,
  collectRunningSessionIds,
  cleanSessionPreview,
  mapSessionGroups,
  pickContinueSession,
  type InkstoneSessionRow,
} from '../host/host-bridge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { blockedByOfflineSnapshot, formatSnapshotAge } from '../host/offline-guard.js';

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

export interface PrototypeSession {
  id: string;
  title: string;
  mode: 'chat' | 'code';
  project?: string;
  tree?: string;
  worktree?: boolean;
  kind: string;
  time: string;
  day?: string;
  snippet?: string;
}

function RealSessionRows({
  rows,
  hostCtx,
}: {
  rows: InkstoneSessionRow[];
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const openSession = async (sessionId: string): Promise<void> => {
    if (blockedByOfflineSnapshot(hostCtx, dispatch)) return;
    await hostCtx.host.handleSelectSession(sessionId);
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
        <div
          className={`session-item ${row.sessionId === hostCtx.host.activeSessionId ? 'active' : ''}`.trim()}
          key={row.sessionId}
          aria-current={row.sessionId === hostCtx.host.activeSessionId ? 'true' : undefined}
        >
          <Dot status={row.status} />
          <button className="session-open" onClick={() => void openSession(row.sessionId)} type="button">
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
              if (blockedByOfflineSnapshot(hostCtx, dispatch)) return;
              void hostCtx.host.handleSelectSession(row.sessionId).then(() => {
                dispatch({ type: 'open-sheet', key: 'session-menu' });
              });
            }}
          />
        </div>
      ))}
    </>
  );
}

function ConnectedSessions({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const listWindow = useSessionListWindow();
  const wide = useWideLayout();
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
  const openSession = async (sessionId: string): Promise<void> => {
    if (blockedByOfflineSnapshot(hostCtx, dispatch)) return;
    await host.handleSelectSession(sessionId);
    dispatch({ type: 'navigate', route: 'chat' });
  };
  const sessionDay = new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date());
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
        <ScreenHeading title="会话" subtitle={`${sessionDay} · 思路仍在继续`} />
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
        {hostCtx.offlineSnapshot !== undefined ? (
          <p className="offline-snapshot" role="status">
            <Icon name="clock" />
            离线快照 · {formatSnapshotAge(hostCtx.offlineSnapshot.savedAt)} · 连上 Host 后自动刷新
          </p>
        ) : null}
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
              {cleanSessionPreview(continueSession.lastPreview) || `${continueSession.messageCount ?? 0} 条消息`}
              <br />
              你离开后，工作仍在 Host 上继续。
            </p>
            <div className="spread continue-meta">
              <span className="mono">{continueProject?.displayName ?? '会话'}</span>
              <button onClick={() => void openSession(continueSession.sessionId)} type="button">
                接着看 <Icon name="chevr" />
              </button>
            </div>
          </div>
        ) : host.connectionState.kind !== 'ready' ? (
          // Until the Host answers we do not know whether there are sessions;
          // never claim "no sessions yet" while connecting.
          <div className="session-skeleton" aria-busy="true" aria-label="正在读取 Host 会话">
            <span />
            <span />
            <span />
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
        {listWindow.total !== undefined && host.connectionState.kind === 'ready' ? (
          <div className="list-window">
            <span>
              已显示 {host.sessions.length} / {listWindow.total}
            </span>
            {listWindow.truncated ? (
              <button className="chip" type="button" onClick={host.loadMoreSessions}>
                加载更多
              </button>
            ) : null}
          </div>
        ) : null}
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
        selected={wide ? navTabForRoute(state.route) : 'sessions'}
        inboxCount={pending.size}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}

export function SessionsPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedSessions hostCtx={hostCtx} />;
}
