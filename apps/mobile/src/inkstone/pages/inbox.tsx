import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../inkstone-state.js';
import {
  BottomNav,
  Dot,
  IconButton,
  ListRow,
  Pill,
  TabsRow,
  TopBar,
} from '../inkstone-ui.js';
import {
  mapActivityRows,
  mapPermissionGate,
  type InkstonePermissionGateView,
} from '../host/host-bridge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';

function RealGate({
  gate,
  hostCtx,
}: {
  gate: InkstonePermissionGateView;
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { state, dispatch } = useInkstone();
  const { host } = hostCtx;
  return (
    <article className="gate">
      <div className="spread">
        <Pill variant="zhu">
          <Dot status="waiting" />
          等待批准
        </Pill>
        <span className="muted" style={{ fontSize: 10 }}>
          {gate.destructive ? '破坏性操作' : 'Host 请求'}
        </span>
      </div>
      <h3>{gate.title}</h3>
      <p>{gate.detail}</p>
      {gate.command !== undefined ? <pre className="command">{gate.command}</pre> : null}
      <dl className="facts">
        {gate.cwd !== undefined ? (
          <>
            <dt>工作目录</dt>
            <dd className="mono">{gate.cwd}</dd>
          </>
        ) : null}
        <dt>作用范围</dt>
        <dd>{state.scope === 'once' ? '仅本次操作' : state.scope === 'session' ? '本次会话' : '此项目'} · Host 执行</dd>
      </dl>
      <div className="scope-options" role="group" aria-label="批准范围">
        {(
          [
            ['once', '仅这一次'],
            ['session', '本次会话'],
            ['project', '此项目'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={state.scope === value ? 'active' : ''}
            aria-pressed={state.scope === value}
            onClick={() => dispatch({ type: 'set-scope', scope: value })}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="gate-footer">
        <span>读过之后，再落印。</span>
        <button
          className="seal-button ghost"
          onClick={() => void host.handleResolvePermission('deny', gate.requestId, state.scope)}
          disabled={host.isResolvingPermission}
          aria-label="拒绝本次操作"
          type="button"
        >
          否
        </button>
        <button
          className="seal-button"
          onClick={() => void host.handleResolvePermission('allow', gate.requestId, state.scope)}
          disabled={host.isResolvingPermission}
          aria-label="允许本次操作"
          type="button"
        >
          允
        </button>
      </div>
    </article>
  );
}

function ConnectedInbox({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { state, dispatch } = useInkstone();
  const { host } = hostCtx;
  const gate = mapPermissionGate(host.permissionRequest);
  const { pending, running } = mapActivityRows({
    items: host.activityItems,
    sessions: host.sessions,
    projects: host.projects,
  });
  const otherPending = pending.filter((row) => row.sessionId !== host.activeSessionId);
  const goSession = async (sessionId: string): Promise<void> => {
    await host.handleSelectSession(sessionId);
    dispatch({ type: 'navigate', route: 'chat' });
  };
  return (
    <>
      <TopBar
        title="动态"
        right={
          <IconButton
            name="sliders"
            label="待办通知偏好"
            onClick={() => dispatch({ type: 'open-sheet', key: 'notifications' })}
          />
        }
      />
      <div className="screen-scroll">
        <TabsRow
          items={['待处理', '进行中']}
          selected={state.inboxFilter === '已完成' ? '进行中' : state.inboxFilter}
          onSelect={(value) => dispatch({ type: 'inbox-filter', value })}
        />
        {state.inboxFilter !== '进行中' ? (
          <>
            {gate !== undefined ? <RealGate gate={gate} hostCtx={hostCtx} /> : null}
            {gate === undefined && otherPending.length === 0 ? (
              <p className="session-empty">没有等你处理的事。需要你批准或回答时会出现在这里。</p>
            ) : null}
            {otherPending.length > 0 ? (
              <>
                <div className="section-label">别处的会话</div>
                {otherPending.map((row) => (
                  <ListRow
                    key={row.sessionId}
                    name="bulb"
                    title={row.title}
                    subtitle={row.subtitle}
                    onClick={() => void goSession(row.sessionId)}
                  />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <>
            {running.length === 0 ? (
              <p className="session-empty">现在没有正在运行的工作。</p>
            ) : null}
            {running.map((row) => (
              <ListRow
                key={row.sessionId}
                name="bulb"
                title={row.title}
                subtitle={row.subtitle}
                onClick={() => void goSession(row.sessionId)}
              />
            ))}
          </>
        )}
      </div>
      <BottomNav
        selected="activity"
        inboxCount={pending.length}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}

export function InboxPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedInbox hostCtx={hostCtx} />;
}
