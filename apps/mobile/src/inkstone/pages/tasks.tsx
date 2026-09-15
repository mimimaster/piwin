import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Icon } from '../icons.js';
import { Dot, IconButton, ListRow, Pill, ScreenHeading, TopBar } from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { mapActivityRows } from '../host/host-bridge.js';

interface SubagentData {
  id: string;
  role: string;
  line: string;
  mono: string;
  status: 'running' | 'done' | 'waiting';
  time: string;
  tree: string;
  model: string;
  steps: [number, number];
}

const SUBAGENTS: SubagentData[] = [
  {
    id: 'test-runner',
    role: '补全恢复路径测试',
    line: '执行 session-index.test.ts 边界用例',
    mono: 'TR',
    status: 'running',
    time: '1 分 32 秒',
    tree: 'wt/test-runner',
    model: 'Claude Haiku',
    steps: [2, 4],
  },
  {
    id: 'doc-writer',
    role: '同步文档恢复说明',
    line: '已交付 2 个文件修改，等待审阅',
    mono: 'DW',
    status: 'done',
    time: '3 分钟前',
    tree: 'wt/doc-writer',
    model: 'Claude Sonnet',
    steps: [3, 3],
  },
];

export function TasksPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedTasksPage hostCtx={hostCtx} />;
  }
  const paused = state.run === 'paused';

  return (
    <>
      <TopBar
        title="子代理与任务"
        subtitle={`${state.scheme} · 编排`}
        onBack={() => dispatch({ type: 'navigate', route: 'chat' })}
        right={
          <IconButton
            name="sliders"
            label="编排方案"
            onClick={() => dispatch({ type: 'open-sheet', key: 'scheme' })}
          />
        }
      />
      <div className="screen-scroll">
        <ScreenHeading
          title="远处的工作，看得见。"
          subtitle="异步子代理独立工作树，交付方案先审阅"
        />
        <div className="continue-card compact">
          <div className="spread">
            <span className="eyebrow">编排方案 · {state.scheme}</span>
            <Pill>
              <Dot status={paused ? 'paused' : 'running'} />
              {paused ? '已暂停' : '执行中'}
            </Pill>
          </div>
          <p>主代理等待子代理交付成果；随时可追加要求或取消。</p>
          <div className="button-row">
            <button
              className="full-button"
              onClick={() => dispatch({ type: 'toggle-run' })}
              type="button"
            >
              {paused ? '继续运行' : '暂停全部'}
            </button>
            <button
              className="full-button secondary"
              onClick={() => dispatch({ type: 'open-sheet', key: 'intervene' })}
              type="button"
            >
              追加要求
            </button>
          </div>
        </div>

        {state.candidate === 'pending' ? (
          <>
            <div className="section-label">待审阅交付</div>
            <article className="card">
              <div className="spread">
                <Pill>
                  <Icon name="fork" />
                  doc-writer · 已交付
                </Pill>
                <span className="muted mono" style={{ fontSize: 10 }}>
                  {state.scheme}
                </span>
              </div>
              <h3 className="card-title">候选变更：同步恢复说明</h3>
              <ul className="check-list">
                <li className="ok">
                  <b>✓</b>文档与实现的函数名一致
                </li>
                <li className="ok">
                  <b>✓</b>未改动公共接口
                </li>
                <li className="warn">
                  <b>!</b>README 里的示例路径需要确认
                </li>
              </ul>
              <div className="card-foot">
                <span>
                  2 个文件 · <span className="green">+31</span> <span className="red">−4</span> · 独立工作树
                </span>
                <button
                  className="text-link"
                  onClick={() => dispatch({ type: 'navigate', route: 'review' })}
                  type="button"
                >
                  看差异 <Icon name="chevr" />
                </button>
              </div>
              <div className="button-row">
                <button
                  className="full-button"
                  onClick={() => dispatch({ type: 'candidate-decision', decision: 'merged' })}
                  type="button"
                >
                  合入
                </button>
                <button
                  className="full-button secondary"
                  onClick={() => dispatch({ type: 'candidate-decision', decision: 'rejected' })}
                  type="button"
                >
                  让主代理处理
                </button>
              </div>
            </article>
          </>
        ) : null}

        <div className="section-label">活动子代理</div>
        {SUBAGENTS.map((agent) => (
          <article className="card" key={agent.id} style={{ marginBottom: 10 }}>
            <div className="spread">
              <span className="pill">
                <span className={`monogram ${agent.status}`}>{agent.mono}</span>
                {agent.id}
              </span>
              <span className="mono muted" style={{ fontSize: 11 }}>
                {agent.time}
              </span>
            </div>
            <h3 className="card-title" style={{ margin: '8px 0 4px' }}>
              {agent.role}
            </h3>
            <p style={{ fontSize: 12, color: 'var(--t2)' }}>{agent.line}</p>
            <div className="step-bar">
              {Array.from({ length: agent.steps[1] }).map((_, i) => (
                <i
                  key={i}
                  className={
                    i < agent.steps[0]
                      ? 'on'
                      : i === agent.steps[0] && agent.status === 'running'
                        ? 'now'
                        : ''
                  }
                />
              ))}
            </div>
            <div className="card-foot">
              <span className="mono" style={{ fontSize: 11 }}>
                {agent.tree} · {agent.model}
              </span>
              <button
                className="text-link"
                onClick={() => dispatch({ type: 'open-sheet', key: 'subagent-output' })}
                type="button"
              >
                工作记录 <Icon name="chevr" />
              </button>
            </div>
            <div className="button-row">
              <button
                className="full-button"
                onClick={() => dispatch({ type: 'open-sheet', key: 'intervene' })}
                type="button"
              >
                追加要求
              </button>
              {agent.status === 'running' ? (
                <button
                  className="full-button secondary"
                  onClick={() => dispatch({ type: 'toast', message: `已取消 ${agent.id}` })}
                  type="button"
                >
                  取消
                </button>
              ) : null}
            </div>
          </article>
        ))}

        <div className="section-label">后台守护程序</div>
        <ListRow
          name="term"
          title="pnpm dev"
          subtitle="Vite Dev Server · 5173"
          onClick={() => dispatch({ type: 'open-tool', tool: '终端' })}
        />
        <ListRow
          name="clock"
          title="定时检查依赖更新"
          subtitle="每周一 10:00 执行"
          onClick={() => dispatch({ type: 'navigate', route: 'automations' })}
        />
      </div>
    </>
  );
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
