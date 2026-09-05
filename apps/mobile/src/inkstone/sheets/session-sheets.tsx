import { useState, type ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { Dot, FullButton, ListRow, SwitchRow } from '../inkstone-ui.js';
import { Icon } from '../icons.js';
import { SessionRows } from '../pages/sessions.js';

export function SessionMenuSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <ListRow
        name="pin"
        title={state.pinned ? '取消置顶' : '置顶会话'}
        onClick={() => dispatch({ type: 'pin-session' })}
      />
      <ListRow name="file" title="重命名" onClick={openSheet('rename')} />
      <ListRow name="fork" title="会话树与分叉" onClick={openSheet('branches')} />
      <ListRow name="folder" title="继续到项目" onClick={openSheet('projects')} />
      <ListRow name="file" title="历史刻度" onClick={openSheet('history')} />
      <ListRow
        name="panel"
        title="在桌面继续"
        subtitle="演示接续入口"
        onClick={openSheet('handoff')}
      />
      <ListRow
        name="archive"
        title="归档会话"
        subtitle="归档后可从设置恢复"
        onClick={() => dispatch({ type: 'archive-session' })}
      />
      <ListRow
        name="copy"
        title="导出会话"
        subtitle="下载本原型的示例文本"
        onClick={exportSession(state, dispatch)}
      />
    </>
  );
}

function exportSession(
  state: { currentTitle: string; messages: string[] },
  dispatch: (action: { type: 'close-sheet' } | { type: 'toast'; message: string }) => void,
): () => void {
  return () => {
    const blob = new Blob(
      [
        `# ${state.currentTitle}\n\nInkstone 移动端原型 · 示例数据\n\n${state.messages.join('\n\n')}`,
      ],
      { type: 'text/markdown;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'inkstone-demo-session.md';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dispatch({ type: 'close-sheet' });
    dispatch({ type: 'toast', message: '已导出演示会话' });
  };
}

export function RenameSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  const [title, setTitle] = useState(state.currentTitle);
  return (
    <>
      <label className="field">
        会话名称
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          autoComplete="off"
        />
      </label>
      <FullButton onClick={() => dispatch({ type: 'rename-session', title: title.trim() })}>
        保存名称
      </FullButton>
    </>
  );
}

export function BranchesSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  return (
    <>
      <p>分叉保留此前上下文，从选定位置另起一页。</p>
      <div className="tool-thread">
        <div className="tool-step">
          <Dot status="done" />
          最初的想法 <span>09:20</span>
        </div>
        <div className="tool-step">
          <Dot status="done" />
          会话恢复方案 <span>09:28</span>
        </div>
        <div className="tool-step">
          <Dot status="running" />
          {state.currentTitle} <span>当前</span>
        </div>
      </div>
      <ListRow
        name="branch"
        title="只恢复阅读位置"
        subtitle="已有分支 · 2 条消息"
        onClick={() => dispatch({ type: 'switch-branch', title: '只恢复阅读位置' })}
      />
      <FullButton onClick={() => dispatch({ type: 'fork-session' })}>从当前消息分叉</FullButton>
    </>
  );
}

export function HistorySheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <ListRow
        name="panel"
        title="用户提出会话记忆"
        subtitle="09:32 · 检查点"
        onClick={() => dispatch({ type: 'history-jump' })}
      />
      <ListRow
        name="cards"
        title="实施计划生成"
        subtitle="09:33 · 4 个步骤"
        onClick={() => dispatch({ type: 'navigate', route: 'plan' })}
      />
      <ListRow
        name="git"
        title="第一组文件变更"
        subtitle="09:34 · 3 个文件"
        onClick={() => dispatch({ type: 'navigate', route: 'review' })}
      />
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'fork-session' })}>
        在当前检查点分叉
      </FullButton>
    </>
  );
}

export function ProjectsSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  return (
    <>
      {(
        [
          ['piwin', '~/Developer/piwin'],
          ['日常与灵感', '~/Documents/ideas'],
        ] as [string, string][]
      ).map(([project, path]) => (
        <ListRow
          key={project}
          name="folder"
          title={project}
          subtitle={path}
          onClick={() => dispatch({ type: 'choose-project', value: project })}
          trailing={state.selectedProject === project ? '✓' : undefined}
          selected={state.selectedProject === project}
        />
      ))}
      <ListRow
        name="plus"
        title="打开 Host 工作区"
        subtitle="选择 Host 上的目录"
        onClick={() => dispatch({ type: 'open-sheet', key: 'workspace-picker' })}
      />
    </>
  );
}

export function WorkspacePickerSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [path, setPath] = useState('~/Developer/piwin');
  return (
    <>
      <label className="field">
        目录路径
        <input value={path} onChange={(event) => setPath(event.target.value)} autoComplete="off" />
      </label>
      <ListRow
        name="folder"
        title="Developer"
        subtitle="Host 上的常用位置"
        onClick={() => dispatch({ type: 'choose-project', value: 'piwin' })}
      />
      <ListRow
        name="folder"
        title="Documents"
        subtitle="Host 上的常用位置"
        onClick={() => dispatch({ type: 'choose-project', value: '日常与灵感' })}
      />
      <FullButton onClick={() => dispatch({ type: 'open-sheet', key: 'trust' })}>
        选择并查看信任提示
      </FullButton>
    </>
  );
}

export function TrustSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <p>信任后，Agent 可以按 Host 的权限策略使用这个项目中的工具与指令。</p>
      <div className="command">~/Developer/piwin</div>
      <FullButton onClick={() => dispatch({ type: 'trust-project' })}>信任并打开 · 演示</FullButton>
      <FullButton variant="subtle" onClick={() => dispatch({ type: 'close-sheet' })}>
        返回
      </FullButton>
    </>
  );
}

export function SearchSheet(): ReactElement {
  const [query, setQuery] = useState('');
  return (
    <>
      <label className="search-field">
        <Icon name="search" />
        <input
          aria-label="搜索会话"
          placeholder="搜索会话名称…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="section-label">最近的会话</div>
      <div className="session-tree">
        <SessionRows query={query} />
      </div>
    </>
  );
}

export function HandoffSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  return (
    <>
      <div className="host-card">
        <span className="host-monogram">书</span>
        <span>
          <strong>书房的 Mac Studio</strong>
          <small>同一 Host · {state.currentTitle}</small>
        </span>
      </div>
      <p style={{ marginTop: 18 }}>
        建议功能：桌面收到定位请求后打开这段会话，不重启 Agent，也不重新发送消息。
      </p>
      <FullButton
        onClick={() =>
          dispatch({
            type: 'save-demo',
            values: {},
            message: '演示：桌面定位请求已展示，未发送真实请求',
          })
        }
      >
        演示定位到桌面
      </FullButton>
    </>
  );
}

export function HostSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  return (
    <>
      <ListRow
        name="panel"
        title="书房的 Mac Studio"
        subtitle={state.offline ? '连接已断开' : '已连接 · 私有网络'}
        onClick={() => dispatch({ type: 'pair-demo' })}
        trailing={state.offline ? '重连' : '✓'}
      />
      <ListRow
        name="panel"
        title="MacBook Pro"
        subtitle="上次连接 · 昨天"
        onClick={() => dispatch({ type: 'pair-demo' })}
      />
      <ListRow
        name="plus"
        title="配对一台 Host"
        onClick={() => dispatch({ type: 'navigate', route: 'connect' })}
      />
      <FullButton
        variant="secondary"
        onClick={() => dispatch(state.offline ? { type: 'reconnect' } : { type: 'disconnect' })}
      >
        {state.offline ? '恢复连接演示' : '体验断线状态'}
      </FullButton>
    </>
  );
}

export function PairingSheet(): ReactElement {
  const { dispatch } = useInkstone();
  return (
    <>
      <div className="empty-state">
        <span className="brand-seal">砚</span>
        <h2>在桌面打开「手机接入」。</h2>
        <p>
          真实使用时，在这里扫描一次性配对码。
          <br />
          本原型不调用相机。
        </p>
      </div>
      <FullButton onClick={() => dispatch({ type: 'pair-demo' })}>使用示例配对码体验</FullButton>
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'open-sheet', key: 'manual-connect' })}
      >
        手动连接
      </FullButton>
    </>
  );
}

export function ManualConnectSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const [address, setAddress] = useState('wss://studio.example.test');
  const [code, setCode] = useState('INKSTONE-DEMO');
  return (
    <>
      <label className="field">
        Host 地址
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="field">
        配对码（仅用演示数据）
        <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" />
      </label>
      <p>本表单仅演示，不发送任何网络请求。</p>
      <FullButton
        onClick={() =>
          dispatch({ type: 'manual-connect', address: address.trim(), code: code.trim() })
        }
      >
        连接示例 Host
      </FullButton>
    </>
  );
}

export function NotificationsSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  return (
    <>
      <p>移动端建议：完成、失败和需要批准时提醒。安静的工作不必打断你。</p>
      <SwitchRow
        title="重要事件通知"
        subtitle="完成 · 失败 · 等待批准"
        checked={state.notifications}
        onToggle={() => dispatch({ type: 'toggle-notifications' })}
      />
      <SwitchRow
        title="跨设备接续入口"
        subtitle="回到桌面上那段正在进行的工作"
        checked={state.handoff}
        onToggle={() => dispatch({ type: 'toggle-handoff' })}
      />
      <p style={{ fontSize: 11, marginTop: 18 }}>仅改变原型偏好，不申请系统通知权限。</p>
      <FullButton onClick={() => dispatch({ type: 'close-sheet' })}>完成</FullButton>
    </>
  );
}
