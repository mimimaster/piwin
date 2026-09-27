import { useState, type ReactElement } from 'react';
import { navTabForRoute, useWideLayout } from '../use-wide-layout.js';
import { NeedsHost } from '../needs-host.js';
import { useSessionListWindow } from '../../hooks/mobile-session-list.js';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../inkstone-state.js';
import { Icon } from '../icons.js';
import { BottomNav, Dot, IconButton, Pill, Segmented, TabsRow, TopBar } from '../inkstone-ui.js';
import {
  collectPendingPermissionSessionIds,
  collectRunningSessionIds,
  cleanSessionPreview,
  mapSessionGroups,
  pickContinueSession,
} from '../host/host-bridge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { blockedByOfflineSnapshot, formatSnapshotAge } from '../host/offline-guard.js';
import {
  buildSessionSections,
  isSessionListFilter,
  type SessionSection,
  type SessionSectionRow,
} from './session-sections.js';
import { SwipeRow, type SwipeAction } from '../swipe-row.js';
import type { InkstoneAction } from '../inkstone-state.js';
import {
  SESSION_MODE_LABELS,
  filterSessionsByMode,
  pickDefaultAgentProjectId,
  type SessionMode,
} from '../session-mode.js';

const MODE_BY_LABEL = new Map<string, SessionMode>(
  (Object.entries(SESSION_MODE_LABELS) as [SessionMode, string][]).map(([mode, label]) => [
    label,
    mode,
  ]),
);

const EMPTY_BY_MODE: Record<SessionMode, string> = {
  chat: '还没有对话。点右上角的 + 直接开始。',
  agent: '还没有 Agent 会话。点右上角的 + 在项目里开一段。',
};

export function endpointLabel(endpoint: string | undefined): string {
  return (endpoint ?? '').replace(/^wss?:\/\//, '').replace(/\/$/, '') || '私有 Host';
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

/** Which row is slid open; opening one closes the rest, as in iOS lists. */
interface SwipeState {
  openId: string | undefined;
  setOpenId: (sessionId: string | undefined) => void;
}

function sessionSwipeActions(
  row: SessionSectionRow,
  hostCtx: InkstoneHostContextValue,
  dispatch: (action: InkstoneAction) => void,
): SwipeAction[] {
  const { host } = hostCtx;
  const guarded = (run: () => void) => () => {
    if (blockedByOfflineSnapshot(hostCtx, dispatch)) return;
    run();
  };
  const actions: SwipeAction[] = [
    {
      key: 'more',
      label: '更多',
      tone: 'neutral',
      onPress: guarded(() => {
        void host.handleSelectSession(row.sessionId).then(() => {
          dispatch({ type: 'open-sheet', key: 'session-menu' });
        });
      }),
    },
    {
      key: 'pin',
      label: row.pinned ? '取消置顶' : '置顶',
      tone: 'lamp',
      onPress: guarded(() => {
        void host.handlePinSession(row.sessionId, row.pinned).then((ok) => {
          if (ok) dispatch({ type: 'toast', message: row.pinned ? '已取消置顶' : '已置顶' });
        });
      }),
    },
  ];
  if (host.client?.supportsCommand('session/archive') === true) {
    // Archive is recoverable from the Host's archive, so like Mail it needs no confirm.
    actions.push({
      key: 'archive',
      label: '归档',
      tone: 'danger',
      onPress: guarded(() => {
        void host.handleDeleteSession(row.sessionId).then((ok) => {
          if (ok) dispatch({ type: 'toast', message: `已归档「${row.title}」` });
        });
      }),
    });
  }
  return actions;
}

function SessionRows({
  rows,
  hostCtx,
  swipe,
}: {
  rows: SessionSectionRow[];
  hostCtx: InkstoneHostContextValue;
  swipe: SwipeState;
}): ReactElement {
  const { dispatch } = useInkstone();
  const openSession = async (sessionId: string): Promise<void> => {
    if (blockedByOfflineSnapshot(hostCtx, dispatch)) return;
    await hostCtx.host.handleSelectSession(sessionId);
    dispatch({ type: 'navigate', route: 'chat' });
  };
  return (
    <>
      {rows.map((row) => (
        <div
          className={`session-item ${row.sessionId === hostCtx.host.activeSessionId ? 'active' : ''}`.trim()}
          key={row.sessionId}
          aria-current={row.sessionId === hostCtx.host.activeSessionId ? 'true' : undefined}
        >
          {/* Only live work earns a mark; a dot on every finished row is noise. */}
          {row.status !== 'done' ? <Dot status={row.status} /> : null}
          <SwipeRow
            actions={sessionSwipeActions(row, hostCtx, dispatch)}
            open={swipe.openId === row.sessionId}
            onOpenChange={(open) => {
              if (open) swipe.setOpenId(row.sessionId);
              else if (swipe.openId === row.sessionId) swipe.setOpenId(undefined);
            }}
          >
            <button
              className="session-open"
              onClick={() => void openSession(row.sessionId)}
              type="button"
            >
              <span className="session-line">
                <strong>{row.title}</strong>
                {row.time !== '' ? <time>{row.time}</time> : null}
              </span>
              {row.subtitle !== '' ? <small>{row.subtitle}</small> : null}
              {row.scope !== undefined ? (
                <span className="session-scope">
                  <Icon name="folder" />
                  {row.scope}
                </span>
              ) : null}
            </button>
          </SwipeRow>
        </div>
      ))}
    </>
  );
}

function SessionSectionView({
  section,
  hostCtx,
  swipe,
}: {
  section: SessionSection;
  hostCtx: InkstoneHostContextValue;
  swipe: SwipeState;
}): ReactElement {
  const flat = section.kind !== 'project';
  return (
    <div className={`session-section ${section.kind}`}>
      {section.kind === 'flat' ? null : (
        <div className="project-heading">
          <Icon name={section.kind === 'pinned' ? 'pin' : 'folder'} />
          <b>{section.title}</b>
          <small>{section.rows.length}</small>
        </div>
      )}
      <div className={flat ? 'session-tree flat' : 'session-tree'}>
        <SessionRows rows={section.rows} hostCtx={hostCtx} swipe={swipe} />
      </div>
    </div>
  );
}

function ConnectedSessions({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const listWindow = useSessionListWindow();
  const wide = useWideLayout();
  const { state, dispatch } = useInkstone();
  const { host } = hostCtx;
  const mode = state.sessionMode;
  const [openSwipeId, setOpenSwipeId] = useState<string | undefined>();
  const swipe: SwipeState = { openId: openSwipeId, setOpenId: setOpenSwipeId };
  const now = Date.now();
  const running = collectRunningSessionIds(host.activityItems);
  const pending = collectPendingPermissionSessionIds(host.activityItems);
  const modeSessions = filterSessionsByMode(host.sessions, mode);
  const groups = mapSessionGroups({
    sessions: modeSessions,
    projects: host.projects,
    runningSessionIds: running,
    pendingPermissionSessionIds: pending,
    now,
  });
  // Conversations are one time-ordered list; only Agent work is filtered and grouped by project.
  const filter =
    mode === 'agent' && isSessionListFilter(state.sessionFilter) ? state.sessionFilter : '全部';
  const built = buildSessionSections(groups, filter);
  const listView =
    mode === 'chat'
      ? {
          sections: built.sections.map((section) =>
            section.kind === 'project' ? { ...section, kind: 'flat' as const } : section,
          ),
          emptyMessage: built.emptyMessage === undefined ? undefined : EMPTY_BY_MODE.chat,
        }
      : {
          ...built,
          emptyMessage:
            built.emptyMessage !== undefined && filter === '全部'
              ? EMPTY_BY_MODE.agent
              : built.emptyMessage,
        };
  const continueSession = mode === 'agent' ? pickContinueSession(modeSessions, running) : undefined;
  const startDraft = (): void => {
    dispatch({
      type: 'start-draft',
      draft: {
        mode,
        projectId:
          mode === 'agent' ? pickDefaultAgentProjectId(host.sessions, host.projects) : undefined,
      },
    });
  };
  const continueProject = host.projects.find(
    (project) => project.projectId === continueSession?.projectId,
  );
  const openSession = async (sessionId: string): Promise<void> => {
    if (blockedByOfflineSnapshot(hostCtx, dispatch)) return;
    await host.handleSelectSession(sessionId);
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
              label={mode === 'agent' ? '新建 Agent 会话' : '新对话'}
              onClick={startDraft}
              extra="red-fill"
            />
          </>
        }
      />
      <div className="screen-scroll">
        <Segmented
          label="会话类型"
          items={[
            [SESSION_MODE_LABELS.chat, undefined],
            [SESSION_MODE_LABELS.agent, undefined],
          ]}
          selected={SESSION_MODE_LABELS[mode]}
          onSelect={(label) => {
            const next = MODE_BY_LABEL.get(label);
            if (next !== undefined) dispatch({ type: 'set-session-mode', mode: next });
          }}
        />
        {host.connectionState.kind !== 'ready' ? (
          // Connected is the normal state and needs no row; only trouble is shown.
          <button
            className="host-card"
            onClick={() => dispatch({ type: 'open-sheet', key: 'host' })}
            type="button"
          >
            <Dot status="waiting" />
            <span className="grow">
              <strong>{endpointLabel(host.endpoint)}</strong>
              <small>{hostConnectionSubtitle(host)}</small>
            </span>
            <Icon name="chevd" />
          </button>
        ) : null}
        {hostCtx.offlineSnapshot !== undefined ? (
          <p className="offline-snapshot" role="status">
            <Icon name="clock" />
            离线快照 · {formatSnapshotAge(hostCtx.offlineSnapshot.savedAt)} · 连上 Host 后自动刷新
          </p>
        ) : null}
        {continueSession !== undefined ? (
          <button
            className="continue-card"
            type="button"
            onClick={() => void openSession(continueSession.sessionId)}
          >
            <span className="spread">
              <span className="eyebrow">
                {running.has(continueSession.sessionId) ? '正在工作' : '接着上次'}
                {continueProject !== undefined ? ` · ${continueProject.displayName}` : ''}
              </span>
              <Pill>
                <Dot status={running.has(continueSession.sessionId) ? 'running' : 'done'} />
                {running.has(continueSession.sessionId) ? '工作中' : '继续'}
                <Icon name="chevr" />
              </Pill>
            </span>
            <h3>{continueSession.name?.trim() || '未命名会话'}</h3>
            <p>
              {cleanSessionPreview(continueSession.lastPreview) ||
                `${continueSession.messageCount ?? 0} 条消息`}
            </p>
          </button>
        ) : host.connectionState.kind !== 'ready' && host.sessions.length === 0 ? (
          // Until the Host answers we do not know whether there are sessions;
          // never claim "no sessions yet" while connecting.
          <div className="session-skeleton" aria-busy="true" aria-label="正在读取 Host 会话">
            <span />
            <span />
            <span />
          </div>
        ) : null}
        {mode === 'agent' ? (
          <TabsRow
            items={['全部', '进行中', '置顶']}
            selected={state.sessionFilter}
            onSelect={(value) => dispatch({ type: 'session-filter', value })}
          />
        ) : null}
        {listView.sections.map((section) => (
          <SessionSectionView key={section.key} section={section} hostCtx={hostCtx} swipe={swipe} />
        ))}
        {listView.emptyMessage !== undefined && host.connectionState.kind === 'ready' ? (
          <p className="session-empty">{listView.emptyMessage}</p>
        ) : null}
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
        {pending.size > 0 ? (
          <button
            className="notice-strip"
            onClick={() => dispatch({ type: 'navigate', route: 'inbox' })}
            type="button"
          >
            <Icon name="bulb" />
            <span>有 {pending.size} 件事，等你落笔。</span>
            <Icon name="chevr" />
          </button>
        ) : null}
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
