import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute, type InkstoneState } from '../demo-state.js';
import { Icon } from '../icons.js';
import {
  BottomNav,
  Dot,
  IconButton,
  LiveCapsule,
  Pill,
  Segmented,
  ScreenHeading,
  TabsRow,
  TopBar,
  type DotStatus,
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

export const PROTOTYPE_SESSIONS: PrototypeSession[] = [
  { id: 'memory', title: '让会话拥有记忆', mode: 'code', project: 'piwin', tree: 'main', kind: 'memory', time: '刚刚' },
  { id: 'reconnect', title: '修复移动端重连', mode: 'code', project: 'piwin', tree: 'feat/mobile-reconnect', worktree: true, kind: 'reconnect', time: '26 分钟' },
  { id: 'theme', title: 'Inkstone · 桌面主题', mode: 'code', project: 'piwin', tree: 'main', kind: 'delivered', time: '1 小时', snippet: '走查报告已就绪 · 4 个文件' },
  { id: 'deps', title: '升级 Pi 依赖', mode: 'code', project: 'piwin', tree: 'main', kind: 'error', time: '昨天' },
  { id: 'docsite', title: '文档站换肤', mode: 'code', project: 'piwin-docs', tree: 'main', kind: 'delivered', time: '3 天前', snippet: '已交付 · 6 个文件' },
  { id: 'scratch', title: '润色一封英文邮件', mode: 'chat', kind: 'plain', day: '今天', time: '08:12', snippet: '语气保持礼貌，句子更短' },
  { id: 'hostdoc', title: 'Host 的边界与职责', mode: 'chat', kind: 'plain', day: '昨天', time: '昨天', snippet: '引用 2 处知识库 · piwin 文档' },
  { id: 'reading', title: '周末读书笔记', mode: 'chat', kind: 'plain', day: '更早', time: '周四', snippet: '已记下 5 条便签' },
  { id: 'trip', title: '十月京都行程', mode: 'chat', kind: 'plain', day: '更早', time: '9月8日', snippet: '四天 · 不赶路的版本' },
];

export function getSessionStatus(id: string, state: InkstoneState): { dot: DotStatus; text: string; tone?: string } {
  if (id === 'memory') {
    return state.run === 'running'
      ? { dot: 'running', text: state.candidate === 'pending' ? '工作中 · 1 份交付待审阅' : '正在补全恢复路径测试' }
      : state.run === 'paused'
        ? { dot: 'paused', text: '已暂停 · 等你继续', tone: 'tone-lamp' }
        : { dot: 'done', text: '本轮已完成 · 走查报告就绪' };
  }
  if (id === 'reconnect') {
    return state.permission === 'pending'
      ? { dot: 'waiting', text: '等你批准 1 项操作', tone: 'tone-zhu' }
      : state.question === 'pending'
        ? { dot: 'waiting', text: 'Agent 在问你 1 个问题', tone: 'tone-zhu' }
        : { dot: 'running', text: state.permission === 'denied' ? '已拒绝测试 · 改用静态检查' : '正在验证重连不重复发送' };
  }
  if (id === 'deps') {
    return state.failure === 'failed'
      ? { dot: 'failed', text: '运行失败 · 供应商限流 429', tone: 'tone-crimson' }
      : { dot: 'running', text: '正在从失败的步骤重试' };
  }
  return { dot: 'done', text: '已完成' };
}

export function getAttentionItems(state: InkstoneState): { key: string; session: string; title: string; label: string }[] {
  const items: { key: string; session: string; title: string; label: string }[] = [];
  if (state.permission === 'pending') {
    items.push({ key: 'permission', session: 'reconnect', title: '修复移动端重连', label: '等待批准' });
  }
  if (state.question === 'pending') {
    items.push({ key: 'question', session: 'reconnect', title: '修复移动端重连', label: '等你回答' });
  }
  if (state.candidate === 'pending') {
    items.push({ key: 'candidate', session: 'memory', title: '让会话拥有记忆', label: '审阅交付' });
  }
  if (state.failure === 'failed') {
    items.push({ key: 'failure', session: 'deps', title: '升级 Pi 依赖', label: '运行失败' });
  }
  return items;
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
  const openSession = async (sessionId: string): Promise<void> => {
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
        <div className="session-item" key={row.sessionId}>
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

function DemoSessions(): ReactElement {
  const { state, dispatch } = useInkstone();
  const pinnedIds = state.pinned ? ['memory', 'hostdoc'] : ['hostdoc'];
  const isPinned = (id: string) => pinnedIds.includes(id);

  const attentionItems = getAttentionItems(state);
  const attentionText = attentionItems
    .slice(0, 2)
    .map((item) => `${item.title} · ${item.label}`)
    .join('；');

  const live = PROTOTYPE_SESSIONS.filter((item) => !(state.archived && item.id === 'memory'));
  const chat = live.filter((item) => item.mode === 'chat');
  const code = live.filter((item) => item.mode === 'code');

  const renderSessionRow = (item: PrototypeSession) => {
    const st = getSessionStatus(item.id, state);
    return (
      <div className="session-item" key={item.id}>
        <Dot status={st.dot} />
        <button
          className="session-open"
          onClick={() => {
            dispatch({ type: 'open-session', title: item.title });
          }}
          type="button"
        >
          <strong>
            {isPinned(item.id) ? <Icon name="pin" extra="inline-pin" /> : null}
            {item.title}
          </strong>
          <small>
            <span className={st.tone ?? ''}>{st.text}</span>
            <span>· {item.time}</span>
          </small>
        </button>
        <IconButton
          name="more"
          label={`${item.title}的更多操作`}
          onClick={() => dispatch({ type: 'open-sheet', key: 'session-menu' })}
        />
      </div>
    );
  };

  const renderGroup = (label: string, list: PrototypeSession[], isTree = false) => {
    if (list.length === 0) return null;
    return (
      <div key={label}>
        <div className="group-label">
          <span>{label}</span>
          <span>{list.length}</span>
        </div>
        <div className={isTree ? 'session-tree' : 'session-list'}>
          {list.map(renderSessionRow)}
        </div>
      </div>
    );
  };

  const projects: [string, string][] = [
    ['piwin', '~/Developer/piwin'],
    ['piwin-docs', '~/Developer/piwin-docs'],
  ];

  return (
    <>
      <header className="topbar">
        <span className="brand-seal">砚</span>
        <div className="topbar-title">
          <h2>会话</h2>
          <button
            className="host-line"
            onClick={() => dispatch({ type: 'open-sheet', key: 'host' })}
            type="button"
          >
            <Dot status={state.offline ? 'waiting' : 'done'} />
            书房的 Mac Studio{state.offline ? ' · 已断开' : ' · 已连接'}
            <Icon name="chevd" />
          </button>
        </div>
        <IconButton
          name="search"
          label="搜索会话"
          onClick={() => dispatch({ type: 'open-sheet', key: 'search' })}
        />
        <IconButton
          name="plus"
          label="新建素笺"
          onClick={() => dispatch({ type: 'navigate', route: 'new' })}
          extra="red-fill"
        />
      </header>
      <LiveCapsule />
      {state.offline ? (
        <div className="banner-offline">
          <span>连接中断 · 显示 09:38 的快照，草稿仍可写</span>
          <button onClick={() => dispatch({ type: 'reconnect' })} type="button">
            重新连接
          </button>
        </div>
      ) : null}
      <div className="screen-scroll">
        {attentionItems.length > 0 ? (
          <button
            className="attention"
            onClick={() => dispatch({ type: 'navigate', route: 'activity' })}
            type="button"
          >
            <span className="seal-mini" aria-hidden="true">待</span>
            <span className="grow">
              <strong>{attentionItems.length} 件事等你落笔</strong>
              <small>{attentionText}</small>
            </span>
            <Icon name="chevr" />
          </button>
        ) : null}

        {state.run !== 'idle' && !(state.archived && state.currentTitle === '让会话拥有记忆') ? (
          <div className="continue-card compact">
            <div className="spread">
              <span className="eyebrow">桌面上正在进行</span>
              <Pill>
                <Dot status={state.run === 'running' ? 'running' : 'paused'} />
                {state.run === 'running' ? '工作中' : '已暂停'}
              </Pill>
            </div>
            <h3>让会话拥有记忆</h3>
            <p>test-runner 正在补全恢复路径测试 · 你离开后又完成 2 步</p>
            <div className="spread continue-meta">
              <span className="mono">piwin / main · 计划 2/4</span>
              <button
                onClick={() => dispatch({ type: 'open-session', title: '让会话拥有记忆' })}
                type="button"
              >
                接着看 <Icon name="chevr" />
              </button>
            </div>
          </div>
        ) : null}

        <Segmented
          items={[
            ['对话', chat.length],
            ['项目', code.length],
          ]}
          selected={state.pane}
          onSelect={(pane) => dispatch({ type: 'set-pane', pane })}
          label="会话分栏"
        />

        {state.pane === '对话' ? (
          <>
            {renderGroup('置顶', chat.filter((item) => isPinned(item.id)))}
            {['今天', '昨天', '更早'].map((day) =>
              renderGroup(
                day,
                chat.filter((item) => !isPinned(item.id) && item.day === day),
              ),
            )}
            <p className="more-hint">归档的对话在「案头 › 归档管理」</p>
          </>
        ) : (
          <>
            {renderGroup('置顶', code.filter((item) => isPinned(item.id)))}
            {projects.map(([name, path]) => {
              const list = code.filter((item) => item.project === name && !isPinned(item.id));
              const collapsed = state.collapsed.includes(name);
              const trees = [
                ...new Set(
                  code
                    .filter((item) => item.project === name)
                    .map((item) => item.tree ?? 'main'),
                ),
              ];
              return (
                <section
                  className={`project-block ${collapsed ? 'collapsed' : ''}`.trim()}
                  key={name}
                >
                  <div className="project-row">
                    <button
                      className="project-head"
                      onClick={() => dispatch({ type: 'toggle-project', project: name })}
                      aria-expanded={!collapsed}
                      type="button"
                    >
                      <Icon name="chevd" extra="chev" />
                      <Icon name="folder" />
                      <span className="grow">
                        <strong>{name}</strong>
                        <small>{path}</small>
                      </span>
                      <span className="mono muted" style={{ fontSize: 11 }}>
                        {code.filter((item) => item.project === name).length}
                      </span>
                    </button>
                    <IconButton
                      name="plus"
                      label={`在 ${name} 中新建会话`}
                      onClick={() => dispatch({ type: 'navigate', route: 'new' })}
                    />
                  </div>
                  {!collapsed ? (
                    <>
                      {trees.map((tree) => {
                        const inTree = list.filter((item) => (item.tree ?? 'main') === tree);
                        if (inTree.length === 0) return null;
                        return (
                          <div key={tree}>
                            <div className="tree-label">
                              <Icon name="branch" />
                              {tree}
                              {inTree[0]?.worktree ? <em>worktree</em> : null}
                            </div>
                            <div className="session-tree">
                              {inTree.map(renderSessionRow)}
                            </div>
                          </div>
                        );
                      })}
                      {name === 'piwin' ? (
                        <p className="more-hint">还有 4 个更早的会话，用搜索查找</p>
                      ) : null}
                    </>
                  ) : null}
                </section>
              );
            })}
            <div className="section-label">
              <span>更多项目</span>
              <button
                onClick={() => dispatch({ type: 'open-sheet', key: 'projects' })}
                type="button"
              >
                全部项目 · 6
              </button>
            </div>
            <button
              className="list-row"
              onClick={() => dispatch({ type: 'open-sheet', key: 'workspace-picker' })}
              type="button"
            >
              <Icon name="folder" />
              <span className="grow">
                <strong>打开 Host 上的文件夹</strong>
                <small>选择目录 · 首次打开需确认信任</small>
              </span>
              <span className="trailing">
                <Icon name="chevr" />
              </span>
            </button>
          </>
        )}
      </div>
      <BottomNav
        selected="sessions"
        attentionCount={attentionItems.length}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}

export function SessionsPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedSessions hostCtx={hostCtx} />;
  }
  return <DemoSessions />;
}
