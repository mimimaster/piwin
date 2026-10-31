import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { Dot } from '../inkstone-ui.js';
import type { InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { blockedByOfflineSnapshot } from '../host/offline-guard.js';
import type { SessionSection, SessionSectionRow } from './session-sections.js';
import { SwipeRow, type SwipeAction } from '@piwin/ui-kit';
import type { InkstoneAction } from '../inkstone-state.js';

/** Which row is slid open; opening one closes the rest, as in iOS lists. */
export interface SwipeState {
  openId: string | undefined;
  setOpenId: (sessionId: string | undefined) => void;
}

function sessionSwipeActions(
  row: SessionSectionRow,
  hostCtx: InkstoneHostContextValue,
  dispatch: (action: InkstoneAction) => void,
  openSession: OpenSession,
): SwipeAction[] {
  const { host } = hostCtx;
  const reportFailure = (error: unknown): void => {
    dispatch({ type: 'toast', message: error instanceof Error ? error.message : 'Host 会话操作失败。' });
  };
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
        void openSession(row.sessionId, row.checkoutMissing, 'menu');
      }),
    },
    {
      key: 'pin',
      label: row.pinned ? '取消置顶' : '置顶',
      tone: 'accent',
      onPress: guarded(() => {
        void host.handlePinSession(row.sessionId, row.pinned).then((ok) => {
          if (ok) dispatch({ type: 'toast', message: row.pinned ? '已取消置顶' : '已置顶' });
        }).catch(reportFailure);
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
        }).catch(reportFailure);
      }),
    });
  }
  return actions;
}

/** Share one selection generation between the rows and the continue card. */
export function useSessionNavigation(hostCtx: InkstoneHostContextValue) {
  const { dispatch } = useInkstone();
  const generation = useRef(0);
  const latestContext = useRef(hostCtx);
  latestContext.current = hostCtx;
  useEffect(() => () => { generation.current += 1; }, []);
  return async (sessionId: string, missing?: boolean, destination: 'chat' | 'menu' = 'chat'): Promise<void> => {
    if (blockedByOfflineSnapshot(hostCtx, dispatch)) return;
    const expected = ++generation.current;
    try {
      await hostCtx.host.handleSelectSession(sessionId);
      if (generation.current !== expected ||
          latestContext.current.host.client !== hostCtx.host.client ||
          latestContext.current.host.connectionState.kind !== 'ready' ||
          latestContext.current.offlineSnapshot !== undefined) return;
      dispatch(destination === 'menu'
        ? { type: 'open-sheet', key: 'session-menu' }
        : { type: 'navigate', route: 'chat' });
      if (missing) dispatch({ type: 'toast', message: 'Host 检出目录缺失；历史仍可读取。' });
    } catch (error: unknown) {
      if (generation.current === expected && latestContext.current.host.client === hostCtx.host.client) {
        dispatch({ type: 'toast', message: error instanceof Error ? error.message : '读取 Host 会话失败。' });
      }
    }
  };
}

type OpenSession = ReturnType<typeof useSessionNavigation>;

/** One identity per row: a cross-project row names its project, a project row its checkout. */
function SessionRowFacts({ row }: { row: SessionSectionRow }): ReactElement {
  // Scope and checkout can only both be known for rows pulled out of their
  // project heading (pinned / filtered). Showing three facts squeezes the
  // preview down to a few glyphs, so the project wins and the rest stays in ⋯.
  if (row.scope !== undefined) return <></>;
  return (
    <>
      {row.checkoutKind === undefined ? null : (
        <span className="session-fact">{row.checkoutKind === 'primary' ? '主检出' : '工作树'}</span>
      )}
      {row.branch === undefined ? null : <span className="session-fact">分支 · {row.branch}</span>}
    </>
  );
}

function SessionRows({
  rows,
  hostCtx,
  swipe,
  openSession,
}: {
  rows: SessionSectionRow[];
  hostCtx: InkstoneHostContextValue;
  swipe: SwipeState;
  openSession: OpenSession;
}): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      {rows.map((row) => {
        const active = row.sessionId === hostCtx.host.activeSessionId;
        return (
          <div
            className={`session-item ${active ? 'active' : ''}`.trim()}
            key={row.sessionId}
            aria-current={active ? 'true' : undefined}
          >
            <SwipeRow
              actions={sessionSwipeActions(row, hostCtx, dispatch, openSession)}
              open={swipe.openId === row.sessionId}
              onOpenChange={(open) => {
                if (open) swipe.setOpenId(row.sessionId);
                else if (swipe.openId === row.sessionId) swipe.setOpenId(undefined);
              }}
            >
              <div className="session-row">
                <button
                  className="session-open"
                  onClick={() => void openSession(row.sessionId, row.checkoutMissing)}
                  type="button"
                >
                  <span className="session-line">
                    {/* Only live work earns a mark; a dot on every finished row is noise. */}
                    <span className="session-mark">
                      {row.status !== 'done' ? <Dot status={row.status} /> : null}
                    </span>
                    <strong>{row.title}</strong>
                    {row.time !== '' ? <time>{row.time}</time> : null}
                  </span>
                  <span className="session-meta">
                    {row.subtitle === '' ? null : (
                      <span className="session-preview">{row.subtitle}</span>
                    )}
                    {row.scope === undefined ? null : (
                      <span className="session-scope">{row.scope}</span>
                    )}
                    <SessionRowFacts row={row} />
                  </span>
                  {row.checkoutMissing ? (
                    <span className="session-warn">Host 检出目录缺失 · 历史仍可读取</span>
                  ) : null}
                  {row.projectMetadataMissing ? (
                    <span className="session-warn">Host 未提供项目信息</span>
                  ) : null}
                </button>
                <button
                  className="session-more"
                  type="button"
                  title="更多操作"
                  aria-label={`${row.title} 的更多操作`}
                  onClick={() => void openSession(row.sessionId, row.checkoutMissing, 'menu')}
                >
                  <Icon name="more" />
                </button>
              </div>
            </SwipeRow>
          </div>
        );
      })}
    </>
  );
}

export function SessionSectionView({
  section,
  hostCtx,
  swipe,
  openSession,
}: {
  section: SessionSection;
  hostCtx: InkstoneHostContextValue;
  swipe: SwipeState;
  openSession: OpenSession;
}): ReactElement {
  const { dispatch } = useInkstone();
  // Pinned draws a heading but never indents; only project groups own a checkout.
  const showHeading = section.kind !== 'flat';
  const [collapsed, setCollapsed] = useState(false);
  // A new session needs one project; a repository group spans several checkouts,
  // so the group's first session decides (it is what the heading already names).
  const projectId = section.kind === 'project' ? section.projectId : undefined;
  return (
    <div className={`session-section ${section.kind}`}>
      {showHeading ? (
        <div className="project-heading">
          <button
            className="project-toggle"
            type="button"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((open) => !open)}
          >
            <Icon name="chevd" extra={collapsed ? 'chev closed' : 'chev'} />
            <Icon name={section.kind === 'pinned' ? 'pin' : 'folder'} />
            <b>{section.title}</b>
            <small>{section.rows.length}</small>
          </button>
          {projectId === undefined ? null : (
            <button
              className="project-add"
              type="button"
              title={`在 ${section.title} 中新建会话`}
              aria-label={`在 ${section.title} 中新建会话`}
              onClick={() =>
                dispatch({ type: 'start-draft', draft: { mode: 'agent', projectId } })
              }
            >
              <Icon name="plus" />
            </button>
          )}
        </div>
      ) : null}
      <div className={`${section.kind === 'project' ? 'session-tree' : 'session-tree flat'}${collapsed ? ' collapsed' : ''}`.trim()}>
        <SessionRows rows={section.rows} hostCtx={hostCtx} swipe={swipe} openSession={openSession} />
        {section.kind === 'project' ? section.checkoutHints?.map((hint) => (
          <div className="session-item hint" key={hint.path}>
            <div className="session-open">
              <span className="session-line"><strong>Host 已发现检出 · 只读</strong></span>
              <span className="session-hint-path">{hint.path}</span>
              <span className="session-meta">
                <span className="session-fact">{hint.isPrimary ? '主检出' : '工作树'}</span>
                {hint.branch === null ? null : (
                  <span className="session-fact">分支 · {hint.branch}</span>
                )}
              </span>
              <span className="session-warn">仅公共列表提示 · 不提供打开或创建操作</span>
            </div>
          </div>
        )) : null}
      </div>
    </div>
  );
}
