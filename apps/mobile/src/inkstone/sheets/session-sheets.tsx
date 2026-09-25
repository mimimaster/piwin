import { useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import type {
  HostResponse,
  SessionExportData,
} from '@piwin/contracts';
import { isRecord } from '../../mobile-host-helpers.js';
import { useInkstone } from '../inkstone-context.js';
import { Dot, FullButton, ListRow } from '../inkstone-ui.js';
import {
  endpointLabel,
  hostConnectionSubtitle,
} from '../pages/sessions.js';
import { cleanSessionPreview, formatClock } from '../host/host-bridge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';

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

export function SessionMenuSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedSessionMenuSheet hostCtx={hostCtx} />;
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

export function RenameSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedRenameSheet hostCtx={hostCtx} />;
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

export function HistorySheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedHistorySheet hostCtx={hostCtx} />;
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

export function HandoffSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedHandoffSheet hostCtx={hostCtx} />;
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
