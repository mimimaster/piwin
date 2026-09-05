import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import {
  BottomNav,
  Dot,
  IconButton,
  ListRow,
  Pill,
  ScreenHeading,
  TabsRow,
  TopBar,
  type DotStatus,
} from '../inkstone-ui.js';

interface DemoSession {
  title: string;
  subtitle: string;
  status: DotStatus;
  time: string;
}

export function demoSessions(
  state: {
    currentTitle: string;
    run: string;
    permission: string;
    pinned: boolean;
  },
  query: string,
  sessionFilter: string,
): DemoSession[] {
  const sessions: DemoSession[] = [
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
  return sessions.filter(
    (session) =>
      session.title.toLowerCase().includes(query.toLowerCase()) &&
      (sessionFilter !== '进行中' || session.status === 'running') &&
      (sessionFilter !== '置顶' || session.title === state.currentTitle),
  );
}

export function SessionRows({ query = '' }: { query?: string }): ReactElement {
  const { state, dispatch } = useInkstone();
  const sessions = demoSessions(state, query, state.sessionFilter);
  if (sessions.length === 0) {
    return (
      <div className="empty-state">
        <h2>这一页还是空的</h2>
        <p>换个关键词，或开始一段新对话。</p>
      </div>
    );
  }
  return (
    <>
      {sessions.map((session) => {
        const { title, subtitle, status, time } = session;
        return (
          <div className="session-item" key={title}>
            <Dot status={status} />
            <button
              className="session-open"
              onClick={() => dispatch({ type: 'open-session', title })}
              type="button"
            >
              <strong>
                {title}
                {state.pinned && title === state.currentTitle ? ' · 置顶' : ''}
              </strong>
              <small>
                {subtitle}
                <span>· {time}</span>
              </small>
            </button>
            <IconButton
              name="more"
              label={`${title}的更多操作`}
              onClick={() => dispatch({ type: 'open-sheet', key: 'session-menu' })}
            />
          </div>
        );
      })}
    </>
  );
}

export function inboxCount(permission: string, planApproved: boolean): number {
  return (permission === 'pending' ? 1 : 0) + (planApproved ? 0 : 1);
}

export function SessionsPage(): ReactElement {
  const { state, dispatch } = useInkstone();
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
        <ListRow
          name="file"
          title="写给未来的自己"
          subtitle="今天 · 一段新的产品想法"
          onClick={() => dispatch({ type: 'open-session', title: '写给未来的自己' })}
        />
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
