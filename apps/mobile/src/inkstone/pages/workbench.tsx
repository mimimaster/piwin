import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon, type InkstoneIconName } from '../icons.js';
import { IconButton, ListRow, ScreenHeading, TopBar } from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { endpointLabel } from './sessions.js';

interface ToolTile {
  id: string;
  icon: InkstoneIconName;
  title: string;
  meta: string;
  tag: string;
  action: 'navigate' | 'open-tool';
  val: string;
}

export function WorkbenchPage(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedWorkbenchPage hostCtx={hostCtx} />;
  }

  const tools: ToolTile[] = [
    { id: '变更', icon: 'git', title: '变更与差异', meta: '3 个文件 · +48 −12', tag: 'diff', action: 'navigate', val: 'review' },
    { id: '任务', icon: 'fork', title: '子代理与任务', meta: `2 运行中 · ${state.scheme}`, tag: 'agents', action: 'navigate', val: 'tasks' },
    { id: '终端', icon: 'term', title: '终端输出', meta: 'zsh · 退出码 0 · 快照', tag: 'zsh', action: 'open-tool', val: '终端' },
    { id: '浏览器', icon: 'globe', title: 'Host 浏览器', meta: 'localhost:5173 · 预览', tag: 'web', action: 'open-tool', val: '浏览器' },
    { id: '文件', icon: 'folder', title: '项目文件', meta: '3 个打开 · 2 个修改', tag: 'fs', action: 'open-tool', val: '文件' },
    { id: '画布', icon: 'panelr', title: 'Artifact 画布', meta: '会话记忆 · 1 份就绪', tag: 'html', action: 'open-tool', val: '画布' },
    { id: '文档', icon: 'file', title: '项目文档', meta: 'session-memory.md', tag: 'md', action: 'open-tool', val: '文档' },
    { id: '笔记', icon: 'edit', title: '随手记', meta: '3 点想法 · 关联会话', tag: 'note', action: 'open-tool', val: '笔记' },
    { id: '侧聊', icon: 'chat', title: '侧聊', meta: '正文共享，视图独立', tag: 'side', action: 'open-tool', val: '侧聊' },
  ];

  return (
    <>
      <TopBar
        title="工作台"
        subtitle={`${state.currentTitle} · 工具目录`}
        onBack={() => dispatch({ type: 'navigate', route: 'chat' })}
        right={
          <IconButton
            name="plus"
            label="快捷操作"
            onClick={() => dispatch({ type: 'open-sheet', key: 'workspace-menu' })}
          />
        }
      />
      <div className="screen-scroll">
        <ScreenHeading
          title="右侧面板，摊成一页。"
          subtitle="每个工具独占一屏，操作结论可随时带回砚台"
        />
        <div className="tool-grid">
          {tools.map((t) => (
            <button
              className="tool-tile"
              key={t.id}
              onClick={() => {
                if (t.action === 'navigate') {
                  dispatch({ type: 'navigate', route: t.val as InkstoneRoute });
                } else {
                  dispatch({ type: 'open-tool', tool: t.val });
                }
              }}
              type="button"
            >
              <Icon name={t.icon} />
              <strong>{t.title}</strong>
              <small>{t.meta}</small>
              <kbd>{t.tag}</kbd>
            </button>
          ))}
        </div>
        <div className="section-label">后台服务</div>
        <ListRow
          name="term"
          title="pnpm dev"
          subtitle="本地开发服务 · 端口 5173 · 运行 14 分钟"
          onClick={() => dispatch({ type: 'open-tool', tool: '终端' })}
        />
        <ListRow
          name="globe"
          title="Chrome Headless"
          subtitle="浏览器自动化驱动 · 内存 118MB"
          onClick={() => dispatch({ type: 'open-tool', tool: '浏览器' })}
        />
      </div>
    </>
  );
}

function ConnectedWorkbenchPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const running = host.activityItems.filter((item) => item.status === 'running').length;
  const openChat = () => dispatch({ type: 'navigate', route: 'chat' });
  const openSession = async (sessionId: string): Promise<void> => {
    await host.handleSelectSession(sessionId);
    openChat();
  };
  return (
    <>
      <TopBar title="工作台" subtitle={`${endpointLabel(host.endpoint)} · Host 工具`} onBack={openChat} right={<IconButton name="plus" label="快捷操作" onClick={() => dispatch({ type: 'open-sheet', key: 'workspace-menu' })} />} />
      <div className="screen-scroll">
        <ScreenHeading title="工具只显示真实状态。" subtitle={host.connectionState.kind === 'ready' ? '执行与文件仍归 Host，手机负责呈现与发起请求。' : 'Host 尚未就绪，暂不展示缓存的假工具。'} />
        <div className="notice"><Icon name="panelr" /><b>{running} 个运行中的会话</b><span>{host.sessions.length} 个会话已同步</span></div>
        <div className="section-label">真实入口</div>
        <ListRow name="chat" title="当前会话" subtitle={host.activeSessionId ?? '未选择会话'} onClick={openChat} />
        <ListRow name="cards" title="计划与差异" subtitle="读取 Host 计划、执行状态与审阅入口" onClick={() => dispatch({ type: 'navigate', route: 'plan' })} />
        <ListRow name="fork" title="子代理与任务" subtitle={`${running} 个运行中的 Host 活动`} onClick={() => dispatch({ type: 'navigate', route: 'tasks' })} />
        <ListRow name="book" title="知识库" subtitle={`${host.knowledgeBases.length} 个 Host 信源`} onClick={() => dispatch({ type: 'navigate', route: 'knowledge' })} />
        <div className="section-label">会话工具</div>
        {host.sessions.slice(0, 8).map((session) => (
          <ListRow key={session.sessionId} name="panel" title={session.name?.trim() || '未命名会话'} subtitle={`${session.messageCount ?? 0} 条消息`} onClick={() => void openSession(session.sessionId)} />
        ))}
        {host.sessions.length === 0 ? <div className="empty-state"><p>Host 尚未返回会话，连接恢复后会自动刷新。</p></div> : null}
      </div>
    </>
  );
}
