import { useEffect, useState, type ReactElement } from 'react';
import type {
  HostResponse,
  RemoteSessionSummary,
  SessionBranchListData,
  SessionBranchSwitchData,
  SessionExportData,
  SessionSearchResult,
  WorkspaceWrites,
} from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { Dot, FullButton, ListRow, SwitchRow } from '../inkstone-ui.js';
import { Icon } from '../icons.js';
import {
  SessionRows,
  endpointLabel,
  hostConnectionSubtitle,
} from '../pages/sessions.js';
import { cleanSessionPreview, formatClock } from '../host/host-bridge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readSessionSearch(response: HostResponse): SessionSearchResult {
  if (!response.success || !isRecord(response.data)) {
    return { hits: [], query: '' };
  }
  const hits = Array.isArray(response.data.hits)
    ? response.data.hits.filter((value): value is SessionSearchResult['hits'][number] => {
        if (!isRecord(value) || typeof value.sessionId !== 'string' || typeof value.projectPath !== 'string') {
          return false;
        }
        return (
          (value.scope === undefined || isRecord(value.scope)) &&
          (value.name === undefined || typeof value.name === 'string') &&
          (value.snippet === undefined || typeof value.snippet === 'string') &&
          (value.messageId === undefined || typeof value.messageId === 'string') &&
          (value.updatedAt === undefined || typeof value.updatedAt === 'string') &&
          (value.isPinned === undefined || typeof value.isPinned === 'boolean')
        );
      })
    : [];
  return {
    hits,
    query: typeof response.data.query === 'string' ? response.data.query : '',
  };
}

function readBranchList(response: HostResponse): SessionBranchListData | undefined {
  if (!response.success || !isRecord(response.data) || typeof response.data.sessionId !== 'string' || typeof response.data.revision !== 'string' || !Array.isArray(response.data.branchPoints)) {
    return undefined;
  }
  const branchPoints = response.data.branchPoints.filter((value): value is SessionBranchListData['branchPoints'][number] => {
    if (!isRecord(value) || (value.anchorMessageId !== null && typeof value.anchorMessageId !== 'string') || !Number.isSafeInteger(value.activeIndex) || !Array.isArray(value.siblings)) {
      return false;
    }
    return value.siblings.every((sibling) => {
      if (!isRecord(sibling) || typeof sibling.headMessageId !== 'string' || (sibling.role !== 'user' && sibling.role !== 'assistant') || typeof sibling.preview !== 'string' || typeof sibling.leafPreview !== 'string' || !Number.isSafeInteger(sibling.messageCount) || typeof sibling.writesWorkspace !== 'boolean' || typeof sibling.updatedAt !== 'string') {
        return false;
      }
      return (
        (sibling.responsePreview === undefined || typeof sibling.responsePreview === 'string') &&
        (sibling.responseStatus === undefined || (typeof sibling.responseStatus === 'string' && ['done', 'error', 'streaming', 'interrupted'].includes(sibling.responseStatus)))
      );
    });
  });
  if (branchPoints.length !== response.data.branchPoints.length) return undefined;
  return { sessionId: response.data.sessionId, revision: response.data.revision, branchPoints };
}

function readBranchSwitch(response: HostResponse): SessionBranchSwitchData | undefined {
  if (!response.success || !isRecord(response.data) || typeof response.data.status !== 'string') return undefined;
  if (response.data.status === 'run-active') return { status: 'run-active' };
  if (response.data.status === 'needs-confirmation' && isRecord(response.data.offPathWrites)) {
    const writes = response.data.offPathWrites;
    if (!Array.isArray(writes.files) || !writes.files.every((file) => typeof file === 'string') || typeof writes.hasUnknownWrites !== 'boolean') {
      return undefined;
    }
    const offPathWrites: WorkspaceWrites = {
      files: writes.files,
      hasUnknownWrites: writes.hasUnknownWrites,
    };
    return { status: 'needs-confirmation', offPathWrites };
  }
  if (response.data.status === 'switched' && typeof response.data.sessionId === 'string' && typeof response.data.activeLeafMessageId === 'string' && isRecord(response.data.session)) {
    return response.data as unknown as SessionBranchSwitchData;
  }
  return undefined;
}

function readExportData(response: HostResponse): SessionExportData | undefined {
  if (!response.success || !isRecord(response.data) || typeof response.data.sessionId !== 'string' || typeof response.data.format !== 'string' || typeof response.data.redactTools !== 'boolean' || typeof response.data.byteLength !== 'number') {
    return undefined;
  }
  return {
    sessionId: response.data.sessionId,
    format: response.data.format === 'html' ? 'html' : 'md',
    redactTools: response.data.redactTools,
    byteLength: response.data.byteLength,
    ...(typeof response.data.path === 'string' ? { path: response.data.path } : {}),
    ...(typeof response.data.content === 'string' ? { content: response.data.content } : {}),
  };
}

function latestSessionForProject(
  sessions: RemoteSessionSummary[],
  projectId: string,
): RemoteSessionSummary | undefined {
  return sessions
    .filter((session) => session.projectId === projectId && session.archived !== true)
    .sort((left, right) => {
      const leftTime = left.updatedAt === undefined ? 0 : Date.parse(left.updatedAt);
      const rightTime = right.updatedAt === undefined ? 0 : Date.parse(right.updatedAt);
      return rightTime - leftTime;
    })[0];
}

function sessionToSearchHit(session: RemoteSessionSummary): SessionSearchResult['hits'][number] {
  const preview = cleanSessionPreview(session.lastPreview);
  return {
    sessionId: session.sessionId,
    projectPath: session.projectId ?? '',
    ...(session.name === undefined ? {} : { name: session.name }),
    ...(preview.length === 0 ? {} : { snippet: preview }),
    ...(session.updatedAt === undefined ? {} : { updatedAt: session.updatedAt }),
    ...(session.pinned === undefined ? {} : { isPinned: session.pinned }),
  };
}

export function SessionMenuSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedSessionMenuSheet hostCtx={hostCtx} />;
  }
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

function ConnectedSessionMenuSheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const session = host.sessions.find((item) => item.sessionId === host.activeSessionId);
  const sessionId = host.activeSessionId;
  const [archivePending, setArchivePending] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const close = () => dispatch({ type: 'close-sheet' });
  const open = (key: string) => dispatch({ type: 'open-sheet', key });
  const handleExport = async (): Promise<void> => {
    if (host.client === undefined || sessionId === undefined) {
      dispatch({ type: 'toast', message: '当前没有可导出的 Host 会话。' });
      return;
    }
    try {
      const response = await host.client.request({
        type: 'session/export',
        sessionId,
        format: 'md',
        redactTools: false,
        destination: 'content',
      });
      if (!response.success) {
        dispatch({ type: 'toast', message: response.error });
        return;
      }
      const exported = readExportData(response);
      if (exported?.content === undefined) {
        dispatch({ type: 'toast', message: 'Host 没有返回可下载的会话内容。' });
        return;
      }
      const blob = new Blob([exported.content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const baseName = (session?.name?.trim() || 'piwin-session')
        .replace(/[^\p{L}\p{N}._-]+/gu, '-')
        .replace(/^-+|-+$/g, '') || 'piwin-session';
      link.href = url;
      link.download = `${baseName}.md`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      close();
      dispatch({ type: 'toast', message: '已导出当前 Host 会话' });
    } catch (error) {
      dispatch({ type: 'toast', message: error instanceof Error ? error.message : '导出会话失败。' });
    }
  };
  return (
    <>
      <ListRow
        name="pin"
        title={session?.pinned === true ? '取消置顶' : '置顶会话'}
        subtitle="同步到 Host 会话索引"
        onClick={() => {
          if (sessionId === undefined) return;
          close();
          void host.handlePinSession(sessionId, session?.pinned === true).then((ok) => {
            if (ok) dispatch({ type: 'toast', message: session?.pinned === true ? '已取消置顶' : '已置顶当前会话' });
          });
        }}
      />
      <ListRow name="file" title="重命名" onClick={() => open('rename')} />
      <ListRow name="fork" title="会话树与分叉" onClick={() => open('branches')} />
      <ListRow name="folder" title="继续到项目" onClick={() => open('projects')} />
      <ListRow name="file" title="历史刻度" subtitle="显示已同步的 Host 消息" onClick={() => open('history')} />
      <ListRow
        name="panel"
        title="在桌面继续"
        subtitle="Host 未提供跨设备接续命令"
        onClick={() => open('handoff')}
      />
      {host.client?.supportsCommand('session/archive') ? (
        archivePending ? (
          <div className="notice">
            <Dot status="waiting" />
            <span className="grow">归档后会从默认会话列表隐藏，可在 Host 的归档管理中恢复。</span>
            <div className="button-row">
              <FullButton
                variant="subtle"
                onClick={() => setArchivePending(false)}
                disabled={archiving}
              >
                取消
              </FullButton>
              <FullButton
                onClick={() => {
                  if (sessionId === undefined || archiving) return;
                  setArchiving(true);
                  void host.handleDeleteSession(sessionId).then((ok) => {
                    setArchiving(false);
                    if (!ok) return;
                    close();
                    dispatch({ type: 'navigate', route: 'sessions' });
                    dispatch({ type: 'toast', message: '已归档当前 Host 会话' });
                  });
                }}
                disabled={archiving || sessionId === undefined}
              >
                {archiving ? '归档中…' : '确认归档'}
              </FullButton>
            </div>
          </div>
        ) : (
          <ListRow
            name="archive"
            title="归档会话"
            subtitle="从默认列表隐藏，可恢复"
            onClick={() => setArchivePending(true)}
          />
        )
      ) : (
        <p className="muted">当前 Host 未开放会话归档。</p>
      )}
      <ListRow
        name="copy"
        title="导出会话"
        subtitle="从 Host 读取当前会话内容"
        onClick={() => void handleExport()}
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
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedRenameSheet hostCtx={hostCtx} />;
  }
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

function ConnectedRenameSheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const session = host.sessions.find((item) => item.sessionId === host.activeSessionId);
  const [title, setTitle] = useState(session?.name ?? '');
  const [saving, setSaving] = useState(false);
  const save = async (): Promise<void> => {
    const sessionId = host.activeSessionId;
    const nextTitle = title.trim();
    if (sessionId === undefined || nextTitle.length === 0 || saving) return;
    setSaving(true);
    try {
      const ok = await host.handleRenameSession(sessionId, nextTitle);
      if (ok) {
        dispatch({ type: 'close-sheet' });
        dispatch({ type: 'toast', message: '已更新 Host 会话名称' });
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <label className="field">
        会话名称
        <input value={title} onChange={(event) => setTitle(event.target.value)} autoComplete="off" />
      </label>
      {session === undefined ? <p className="muted">Host 尚未返回当前会话。</p> : null}
      <FullButton onClick={() => void save()} disabled={saving || session === undefined || title.trim().length === 0}>
        {saving ? '保存中…' : '保存名称'}
      </FullButton>
    </>
  );
}

export function BranchesSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedBranchesSheet hostCtx={hostCtx} />;
  }
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

function ConnectedBranchesSheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const sessionId = host.activeSessionId;
  const [branchList, setBranchList] = useState<SessionBranchListData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [confirmation, setConfirmation] = useState<WorkspaceWrites | undefined>();
  const [switchTarget, setSwitchTarget] = useState<string | undefined>();
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const canSwitchBranches = client?.supportsCommand('session/branch-switch') === true;
  const canFork = client?.supportsCommand('session/fork') === true;

  useEffect(() => {
    if (client === undefined || sessionId === undefined) {
      setLoading(false);
      return;
    }
    if (!client.supportsCommand('session/branch-list')) {
      setLoading(false);
      setError('当前 Host 未开放会话分支浏览。');
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    void client.request({ type: 'session/branch-list', sessionId }).then((response) => {
      if (!active) return;
      if (!response.success) {
        setError(response.error);
        return;
      }
      const value = readBranchList(response);
      if (value === undefined) setError('Host 返回了无法识别的分支数据。');
      else setBranchList(value);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : '读取会话分支失败。');
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [client, sessionId]);

  const switchBranch = async (targetMessageId: string, confirm = false): Promise<void> => {
    if (
      client === undefined ||
      sessionId === undefined ||
      !canSwitchBranches ||
      working
    ) {
      setError('当前 Host 未开放分支切换。');
      return;
    }
    setWorking(true);
    setError(undefined);
    try {
      const response = await client.request({
        type: 'session/branch-switch',
        sessionId,
        targetMessageId,
        messageProjection: 'tail',
        ...(confirm ? { confirm: true } : {}),
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const result = readBranchSwitch(response);
      if (result?.status === 'needs-confirmation') {
        setConfirmation(result.offPathWrites);
        setSwitchTarget(targetMessageId);
        return;
      }
      if (result?.status === 'run-active') {
        setError('当前会话仍在运行，请等待完成后再切换分支。');
        return;
      }
      if (result?.status !== 'switched') {
        setError('Host 未返回可识别的分支切换结果。');
        return;
      }
      await host.handleSelectSession(sessionId);
      dispatch({ type: 'close-sheet' });
      dispatch({ type: 'toast', message: '已切换到 Host 分支' });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '切换分支失败。');
    } finally {
      setWorking(false);
    }
  };

  const forkSession = async (): Promise<void> => {
    if (client === undefined || sessionId === undefined || !canFork || working) {
      setError('当前 Host 未开放会话分叉。');
      return;
    }
    setWorking(true);
    setError(undefined);
    try {
      const response = await client.request({
        type: 'session/fork',
        sessionId,
        workspaceStrategy: 'shared',
        messageProjection: 'none',
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      if (!isRecord(response.data) || typeof response.data.sessionId !== 'string') {
        setError('Host 未返回新分支会话 ID。');
        return;
      }
      await host.handleSelectSession(response.data.sessionId);
      dispatch({ type: 'close-sheet' });
      dispatch({ type: 'navigate', route: 'chat' });
      dispatch({ type: 'toast', message: '已从当前 Host 会话创建分支' });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '创建分支失败。');
    } finally {
      setWorking(false);
    }
  };

  if (sessionId === undefined) {
    return <p className="muted">Host 尚未选择会话。</p>;
  }
  return (
    <>
      <p>分支、切换和分叉均由 Host 保存；手机只展示并转发当前选择。</p>
      {client === undefined ? <p className="muted">正在连接 Host…</p> : null}
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      {confirmation !== undefined ? (
        <div className="notice">
          <Dot status="waiting" />
          <span className="grow">
            目标分支之外有 {confirmation.files.length} 个文件写入
            {confirmation.hasUnknownWrites ? '（另有未归类写入）' : ''}
          </span>
          <FullButton
            onClick={() => {
              if (switchTarget !== undefined) void switchBranch(switchTarget, true);
              setConfirmation(undefined);
            }}
            disabled={working || switchTarget === undefined}
          >
            确认切换
          </FullButton>
        </div>
      ) : null}
      {branchList?.branchPoints.map((point, pointIndex) => (
        <div className="tool-thread" key={`${point.anchorMessageId ?? 'root'}:${pointIndex}`}>
          <div className="section-label">分叉点 {pointIndex + 1}</div>
          {point.siblings.map((sibling, siblingIndex) => (
            <ListRow
              key={sibling.headMessageId}
              name="branch"
              title={sibling.preview || '未命名分支'}
              subtitle={`${sibling.role === 'assistant' ? '回答版本' : '提示分支'} · ${sibling.messageCount} 条消息 · ${formatClock(sibling.updatedAt) || '时间未知'}`}
              trailing={siblingIndex === point.activeIndex ? '当前' : undefined}
              selected={siblingIndex === point.activeIndex}
              onClick={() => void switchBranch(sibling.headMessageId)}
            />
          ))}
        </div>
      ))}
      {branchList !== undefined && branchList.branchPoints.length === 0 ? (
        <p className="muted">Host 返回当前路径没有可切换的分叉。</p>
      ) : null}
      {loading ? <p className="muted">正在读取 Host 分支…</p> : null}
      <FullButton onClick={() => void forkSession()} disabled={working || client === undefined || !canFork}>
        {working ? '处理中…' : '从当前消息分叉'}
      </FullButton>
    </>
  );
}

export function HistorySheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedHistorySheet hostCtx={hostCtx} />;
  }
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

function ConnectedHistorySheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const messages = host.messages.filter((message) => message.role === 'user' || message.role === 'assistant').slice(-30);
  return (
    <>
      <p>Host 未提供独立的检查点列表；以下是当前已同步的会话消息。</p>
      {messages.map((message) => (
        <div className="tool-step" key={message.id}>
          <Dot status={message.status === 'streaming' ? 'running' : message.status === 'error' ? 'waiting' : 'done'} />
          <span className="grow">
            <strong>{message.role === 'user' ? '你' : 'piwin'}</strong>
            <small>{cleanSessionPreview(message.text) || (message.status === 'streaming' ? '正在输出…' : '（无文本内容）')}</small>
          </span>
          <span>{formatClock(message.createdAt) || '—'}</span>
        </div>
      ))}
      {messages.length === 0 ? <p className="muted">Host 尚未返回会话消息。</p> : null}
      <div className="button-row">
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'navigate', route: 'plan' })}>打开 Host 计划</FullButton>
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'navigate', route: 'review' })}>打开 Host 审阅</FullButton>
      </div>
    </>
  );
}

export function ProjectsSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedProjectsSheet hostCtx={hostCtx} />;
  }
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

function ConnectedProjectsSheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const [workingProjectId, setWorkingProjectId] = useState<string | undefined>();
  const openProject = async (projectId: string): Promise<void> => {
    if (workingProjectId !== undefined) return;
    setWorkingProjectId(projectId);
    try {
      const existing = latestSessionForProject(host.sessions, projectId);
      const sessionId = existing?.sessionId ?? (await host.handleCreateSession(projectId));
      if (sessionId === undefined) return;
      await host.handleSelectSession(sessionId);
      dispatch({ type: 'close-sheet' });
      dispatch({ type: 'navigate', route: 'chat' });
    } finally {
      setWorkingProjectId(undefined);
    }
  };
  return (
    <>
      <p>选择 Host 已登记的项目。手机不会改写当前会话的项目归属；没有会话时会在该项目中新建一段。</p>
      {host.projects.map((project) => {
        const latest = latestSessionForProject(host.sessions, project.projectId);
        return (
          <ListRow
            key={project.projectId}
            name="folder"
            title={project.displayName}
            subtitle={latest === undefined ? '尚无会话 · 点按新建' : `最近：${latest.name?.trim() || '未命名会话'}`}
            trailing={workingProjectId === project.projectId ? '处理中…' : undefined}
            onClick={() => void openProject(project.projectId)}
          />
        );
      })}
      {host.projects.length === 0 ? <p className="muted">Host 尚未返回可用项目。</p> : null}
      <p className="muted" style={{ fontSize: 11 }}>若要登记新目录，请在 Host 桌面端完成项目信任。</p>
    </>
  );
}

export function WorkspacePickerSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedWorkspacePickerSheet hostCtx={hostCtx} />;
  }
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

function ConnectedWorkspacePickerSheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const openProject = async (projectId: string): Promise<void> => {
    const session = latestSessionForProject(host.sessions, projectId);
    if (session === undefined) {
      dispatch({ type: 'toast', message: '该项目还没有 Host 会话，请先在项目中创建会话。' });
      return;
    }
    await host.handleSelectSession(session.sessionId);
    dispatch({ type: 'close-sheet' });
    dispatch({ type: 'navigate', route: 'workspace' });
  };
  return (
    <>
      <p>这里展示 Host 已登记且可读取的项目。移动端不接受任意路径，也不会绕过 Host 的信任策略。</p>
      {host.projects.map((project) => (
        <ListRow
          key={project.projectId}
          name="folder"
          title={project.displayName}
          subtitle={project.trust === 'trusted' ? 'Host 已信任 · 打开工作区' : 'Host 尚未信任 · 请在桌面端确认'}
          onClick={() => {
            if (project.trust !== 'trusted') {
              dispatch({ type: 'toast', message: '请先在 Host 桌面端确认项目权限。' });
              return;
            }
            void openProject(project.projectId);
          }}
        />
      ))}
      {host.projects.length === 0 ? <p className="muted">Host 尚未返回可用项目。</p> : null}
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
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedSearchSheet hostCtx={hostCtx} />;
  }
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

function ConnectedSearchSheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SessionSearchResult['hits']>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setHits(
        host.sessions
          .filter((session) => session.archived !== true)
          .map(sessionToSearchHit),
      );
      setError(undefined);
      setSearching(false);
      return;
    }
    if (host.client === undefined || !host.client.supportsCommand('session/search')) {
      setHits(
        host.sessions
          .filter((session) => session.archived !== true)
          .filter((session) => `${session.name ?? ''} ${session.lastPreview ?? ''}`.toLowerCase().includes(trimmed.toLowerCase()))
          .map(sessionToSearchHit),
      );
      setError(undefined);
      setSearching(false);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void host.client?.request({ type: 'session/search', query: { query: trimmed, limit: 50 } }).then((response) => {
        if (!active) return;
        if (!response.success) {
          setError(response.error);
          setHits([]);
        } else {
          const result = readSessionSearch(response);
          setHits(result.hits);
          setError(undefined);
        }
        setSearching(false);
      }).catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : '搜索 Host 会话失败。');
        setSearching(false);
      });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [host.client, host.sessions, query]);

  const openHit = async (sessionId: string): Promise<void> => {
    await host.handleSelectSession(sessionId);
    dispatch({ type: 'close-sheet' });
    dispatch({ type: 'navigate', route: 'chat' });
  };
  return (
    <>
      <label className="search-field">
        <Icon name="search" />
        <input aria-label="搜索会话" placeholder="搜索 Host 会话或消息…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      {searching ? <p className="muted">正在搜索 Host…</p> : null}
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      <div className="section-label">Host 会话</div>
      <div className="session-tree">
        {hits.map((hit, index) => {
          const session = host.sessions.find((item) => item.sessionId === hit.sessionId);
          return (
            <ListRow
              key={`${hit.sessionId}:${hit.messageId ?? index}`}
              name="panel"
              title={hit.name?.trim() || session?.name?.trim() || '未命名会话'}
              subtitle={cleanSessionPreview(hit.snippet) || (hit.updatedAt ? formatClock(hit.updatedAt) : 'Host 会话')}
              trailing={hit.isPinned === true ? '置顶' : undefined}
              onClick={() => void openHit(hit.sessionId)}
            />
          );
        })}
      </div>
      {!searching && hits.length === 0 ? <p className="muted">Host 没有匹配的会话。</p> : null}
    </>
  );
}

export function HandoffSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    return <ConnectedHandoffSheet hostCtx={hostCtx} />;
  }
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

function ConnectedHandoffSheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  return (
    <>
      <p>当前连接已经直接使用同一台 Host，会话状态会持续同步到桌面端。</p>
      <div className="host-card">
        <Dot status={host.connectionState.kind === 'ready' ? 'done' : 'waiting'} />
        <span className="grow">
          <strong>{endpointLabel(host.endpoint)}</strong>
          <small>{hostConnectionSubtitle(host)}</small>
        </span>
      </div>
      <p className="muted">Host 尚未提供额外的“定位到桌面”命令；不会在手机端伪造接续成功。</p>
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>返回会话</FullButton>
    </>
  );
}

export function HostSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx !== null) {
    const { host, onOpenConnection } = hostCtx;
    const ready = host.connectionState.kind === 'ready';
    return (
      <>
        <ListRow
          name="panel"
          title={endpointLabel(host.endpoint)}
          subtitle={hostConnectionSubtitle(host)}
          onClick={() =>
            dispatch({ type: 'toast', message: ready ? '已连接这台 Host' : '正在连接…' })
          }
          trailing={ready ? '✓' : '重连'}
          selected={ready}
        />
        <ListRow
          name="plus"
          title="管理连接"
          subtitle="地址 · 配对 · 凭据"
          onClick={onOpenConnection}
        />
        <FullButton variant="secondary" onClick={() => void host.handleDisconnect()}>
          断开连接
        </FullButton>
      </>
    );
  }
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
