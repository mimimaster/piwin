import { useEffect, useRef, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { Dot, Pill } from '../inkstone-ui.js';
import type { InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { blockedByOfflineSnapshot } from '../host/offline-guard.js';
import type { SessionSection, SessionSectionRow } from './session-sections.js';
import { SwipeRow, type SwipeAction } from '../swipe-row.js';
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
      tone: 'lamp',
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
      {rows.map((row) => (
        <div
          className={`session-item ${row.sessionId === hostCtx.host.activeSessionId ? 'active' : ''}`.trim()}
          key={row.sessionId}
          aria-current={row.sessionId === hostCtx.host.activeSessionId ? 'true' : undefined}
        >
          {/* Only live work earns a mark; a dot on every finished row is noise. */}
          {row.status !== 'done' ? <Dot status={row.status} /> : null}
          <SwipeRow
            actions={sessionSwipeActions(row, hostCtx, dispatch, openSession)}
            open={swipe.openId === row.sessionId}
            onOpenChange={(open) => {
              if (open) swipe.setOpenId(row.sessionId);
              else if (swipe.openId === row.sessionId) swipe.setOpenId(undefined);
            }}
          >
            <button
              className="session-open"
              onClick={() => void openSession(row.sessionId, row.checkoutMissing)}
              type="button"
            >
              <span className="session-line">
                <strong>{row.title}</strong>
                {row.time !== '' ? <time>{row.time}</time> : null}
              </span>
              {row.subtitle !== '' ? <small>{row.subtitle}</small> : null}
              {row.checkoutLabel !== undefined ? (
                <small>
                  {row.checkoutLabel}{' '}
                  {row.checkoutKind === undefined ? null : (
                    <Pill>{row.checkoutKind === 'primary' ? '主检出' : '工作树'}</Pill>
                  )}
                </small>
              ) : null}
              {row.branch === undefined ? null : <small>分支 · {row.branch}</small>}
              {row.checkoutMissing ? <small>Host 检出目录缺失 · 历史仍可读取</small> : null}
              {row.projectMetadataMissing ? <small>Host 未提供项目信息</small> : null}
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
        <SessionRows rows={section.rows} hostCtx={hostCtx} swipe={swipe} openSession={openSession} />
        {section.kind === 'project' ? section.checkoutHints?.map((hint) => (
          <div className="session-item" key={hint.path}>
            <div className="session-open">
              <span className="session-line"><strong>Host 已发现检出 · 只读</strong></span>
              <small>{hint.path}</small>
              <small><Pill>{hint.isPrimary ? '主检出' : '工作树'}</Pill></small>
              {hint.branch === null ? null : <small>分支 · {hint.branch}</small>}
              <small>仅公共列表提示 · 不提供打开或创建操作</small>
            </div>
          </div>
        )) : null}
      </div>
    </div>
  );
}
