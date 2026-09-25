import { useEffect, useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { WorkspaceChanges } from './workspace-changes.js';
import { WorkspaceFilePreview, type WorkspaceFile } from './workspace-file-preview.js';
import { WorkspaceJobs } from './workspace-jobs.js';
import { WorkspaceCanvas } from './workspace-canvas.js';
import { WorkspaceSideChat } from './workspace-side-chat.js';
import { WorkspaceBrowser } from './workspace-browser.js';
import type { HostResponse, NoteRecord } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../inkstone-state.js';
import {
  FullButton,
  IconButton,
  ListRow,
  ScreenHeading,
  TabsRow,
  TopBar,
} from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { createMobileIdempotencyKey, executeMobileMutation } from '../../mobile-prompt-send.js';

function ConnectedNoteInspector({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { host } = hostCtx;
  const client = host.client;
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  const load = async (): Promise<void> => {
    if (client === undefined || !client.supportsCommand('notes/list')) {
      setLoading(false);
      setMessage(client === undefined ? undefined : '当前 Host 未开放笔记读取。');
      return;
    }
    setLoading(true);
    try {
      const response = await client.request({ type: 'notes/list' });
      if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.records)) {
        setMessage(response.success ? 'Host 返回了无法识别的笔记数据。' : response.error);
        return;
      }
      const next = response.data.records.filter((value): value is NoteRecord => {
        return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.content === 'string' && typeof value.updatedAt === 'string' && typeof value.createdAt === 'string' && typeof value.collection === 'string' && typeof value.relativePath === 'string' && typeof value.contentHash === 'string';
      });
      setNotes(next);
      const current = next.find((note) => note.id === selectedId) ?? next[0];
      if (current !== undefined) {
        setSelectedId(current.id);
        setTitle(current.title);
        setText(current.content);
      }
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '读取 Host 笔记失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [client]);

  const select = (note: NoteRecord): void => {
    setSelectedId(note.id);
    setTitle(note.title);
    setText(note.content);
    setMessage(undefined);
  };

  const save = async (): Promise<void> => {
    if (client === undefined || saving || title.trim().length === 0) return;
    setSaving(true);
    try {
      const selected = notes.find((note) => note.id === selectedId);
      const command = selected === undefined
        ? { type: 'notes/write' as const, input: { title: title.trim(), content: text } }
        : { type: 'notes/update' as const, input: { id: selected.id, title: title.trim(), content: text, ...(selected.contentHash ? { expectedContentHash: selected.contentHash } : {}) } };
      const response = await executeMobileMutation(
        (request, options) => client.request(request, options),
        command,
        createMobileIdempotencyKey(),
      );
      if (!response.success) {
        setMessage(response.error);
        return;
      }
      setMessage(selected === undefined ? '已写入 Host 笔记。' : '已更新 Host 笔记。');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存 Host 笔记失败。');
    } finally {
      setSaving(false);
    }
  };

  if (client === undefined) {
    return <p className="muted">正在连接 Host，暂不展示本地示例笔记。</p>;
  }
  return (
    <>
      <ScreenHeading title="随手记" subtitle="Host 笔记 · 与当前会话分开保存" />
      {loading ? <p className="muted">正在读取 Host 笔记…</p> : null}
      {message !== undefined ? <p className={message.startsWith('已') ? 'quote-note' : 'error-text'}>{message}</p> : null}
      {notes.map((note) => (
        <ListRow key={note.id} name="file" title={note.title} subtitle={`${note.collection} · ${note.updatedAt}`} selected={note.id === selectedId} onClick={() => select(note)} />
      ))}
      {!loading && notes.length === 0 && message === undefined ? <p className="muted">Host 还没有笔记，填写下面内容即可新建。</p> : null}
      <label className="field">
        标题
        <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：移动端验收记录" />
      </label>
      <label className="field">
        内容
        <textarea rows={9} value={text} onChange={(event) => setText(event.target.value)} placeholder="写下要保存在 Host 的内容" />
      </label>
      <FullButton onClick={() => void save()} disabled={saving || title.trim().length === 0 || !client.supportsCommand(selectedId === undefined ? 'notes/write' : 'notes/update')}>
        {saving ? '保存中…' : '保存到 Host'}
      </FullButton>
      <FullButton variant="subtle" onClick={() => { if (text.trim()) host.setComposerText(text.trim()); }}>把当前内容放入对话</FullButton>
    </>
  );
}

const WORKSPACE_TABS = ['文件', '终端', '变更', '浏览器', '画布', '文档', '笔记', '卡片', '侧聊'];

export function WorkspacePage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedWorkspacePage hostCtx={hostCtx} />;
}

function sessionChangedPaths(messages: InkstoneHostContextValue['host']['messages']): string[] {
  const paths = new Set<string>();
  for (const message of messages) {
    for (const tool of message.toolCalls ?? []) {
      for (const path of tool.presentation?.changedPaths ?? []) paths.add(path);
    }
  }
  return [...paths];
}

type WorkspaceEntry = {
  name: string;
  relativePath: string;
  kind: 'file' | 'directory';
  sizeBytes?: number;
};

type WorkspaceDirectory = {
  relativePath: string;
  entries: WorkspaceEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readWorkspaceDirectory(response: HostResponse): WorkspaceDirectory | undefined {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.entries)) {
    return undefined;
  }
  const entries = response.data.entries.flatMap((value): WorkspaceEntry[] => {
    if (
      !isRecord(value) ||
      typeof value.name !== 'string' ||
      typeof value.relativePath !== 'string' ||
      (value.kind !== 'file' && value.kind !== 'directory')
    ) {
      return [];
    }
    return [
      {
        name: value.name,
        relativePath: value.relativePath,
        kind: value.kind,
        ...(typeof value.sizeBytes === 'number' && value.sizeBytes >= 0
          ? { sizeBytes: value.sizeBytes }
          : {}),
      },
    ];
  });
  return {
    relativePath: typeof response.data.relativePath === 'string' ? response.data.relativePath : '',
    entries,
  };
}

function readWorkspaceFile(response: HostResponse): WorkspaceFile | undefined {
  if (!response.success || !isRecord(response.data) || typeof response.data.content !== 'string') {
    return undefined;
  }
  const data = response.data;
  return {
    relativePath: typeof data.relativePath === 'string' ? data.relativePath : '',
    content: data.content as string,
    byteSize: typeof data.byteSize === 'number' ? data.byteSize : (data.content as string).length,
    truncated: data.truncated === true,
    isBinary: data.isBinary === true,
    ...(typeof data.previewDataUrl === 'string' ? { previewDataUrl: data.previewDataUrl } : {}),
    ...(typeof data.previewThumbDataUrl === 'string' ? { previewThumbDataUrl: data.previewThumbDataUrl } : {}),
  };
}

function ConnectedWorkspacePage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { state, dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const session = host.sessions.find((item) => item.sessionId === host.activeSessionId);
  const project = host.projects.find((item) => item.projectId === session?.projectId) ?? host.projects[0];
  const projectLocator = project?.projectId;
  const [relativePath, setRelativePath] = useState('');
  const [directory, setDirectory] = useState<WorkspaceDirectory | undefined>();
  const [selectedFile, setSelectedFile] = useState<WorkspaceFile | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRelativePath('');
    setDirectory(undefined);
    setSelectedFile(undefined);
    setError(undefined);
  }, [projectLocator]);

  useEffect(() => {
    let cancelled = false;
    if (
      client === undefined ||
      projectLocator === undefined ||
      (state.workspaceTab !== '文件' && state.workspaceTab !== '文档')
    ) {
      return () => {
        cancelled = true;
      };
    }
    if (!client.supportsCommand('project/list-dir')) {
      setError('当前 Host 未开放项目文件浏览。');
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    void client
      .request({
        type: 'project/list-dir',
        projectPath: projectLocator,
        ...(relativePath ? { relativePath } : {}),
      })
      .then((response) => {
        if (cancelled) return;
        const next = readWorkspaceDirectory(response);
        if (next === undefined) {
          setError(response.success ? 'Host 返回了无法识别的目录数据。' : response.error);
        } else {
          setDirectory(next);
          setError(undefined);
        }
        setLoading(false);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '读取项目目录失败。');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectLocator, relativePath, state.workspaceTab]);

  const readFile = async (entry: WorkspaceEntry): Promise<void> => {
    if (client === undefined || projectLocator === undefined || entry.kind !== 'file') return;
    if (!client.supportsCommand('project/read-file')) {
      setError('当前 Host 未开放项目文件读取。');
      return;
    }
    setSelectedFile(undefined);
    const response = await client.request({
      type: 'project/read-file',
      projectPath: projectLocator,
      relativePath: entry.relativePath,
      maxBytes: 256 * 1024,
    });
    const file = readWorkspaceFile(response);
    if (file === undefined) {
      setError(response.success ? 'Host 返回了无法识别的文件内容。' : response.error);
      return;
    }
    setError(undefined);
    setSelectedFile({ ...file, relativePath: entry.relativePath });
  };

  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  const showDirectory = state.workspaceTab === '文件' || state.workspaceTab === '文档';
  const title = project?.displayName ?? 'Host 项目';

  const directoryView = (
    <>
      <ScreenHeading
        title={state.workspaceTab === '文档' ? 'Host 文档' : '项目文件'}
        subtitle={`${title}${directory?.relativePath ? ` · ${directory.relativePath}` : ''}`}
      />
      {relativePath ? (
        <FullButton variant="subtle" onClick={() => setRelativePath(relativePath.split('/').slice(0, -1).join('/'))}>
          返回上一级目录
        </FullButton>
      ) : null}
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      {loading ? <p className="muted">正在读取 Host 目录…</p> : null}
      {!loading && directory?.entries.length === 0 ? <p className="muted">这个目录没有可展示的条目。</p> : null}
      {directory?.entries.map((entry) => (
        <ListRow
          key={entry.relativePath}
          name={entry.kind === 'directory' ? 'folder' : 'file'}
          title={entry.name}
          subtitle={entry.kind === 'directory' ? '目录' : entry.sizeBytes === undefined ? '文件' : `${entry.sizeBytes} B`}
          onClick={() => {
            if (entry.kind === 'directory') {
              setRelativePath(entry.relativePath);
              setSelectedFile(undefined);
            } else {
              void readFile(entry);
            }
          }}
        />
      ))}
    </>
  );

  return (
    <>
      <TopBar
        title="工作区"
        subtitle={`${title} · Host`}
        onBack={go('chat')}
        right={<IconButton name="plus" label="工作区入口" onClick={openSheet('workspace-menu')} />}
      />
      <TabsRow
        items={WORKSPACE_TABS}
        selected={state.workspaceTab}
        onSelect={(tab) => dispatch({ type: 'workspace-tab', tab })}
        extra="workspace-tabs"
      />
      <div className="screen-scroll">
        {showDirectory ? (
          client === undefined ? (
            <>
              <ScreenHeading title="正在连接 Host" subtitle="文件浏览会在连接后开放" />
              <p className="muted">不会展示本地示例文件。</p>
            </>
          ) : projectLocator === undefined ? (
            <>
              <ScreenHeading title="没有可浏览的项目" subtitle="当前会话未绑定项目" />
              <p className="muted">请从 Host 项目会话进入工作区。</p>
            </>
          ) : (
            selectedFile !== undefined ? (
              <WorkspaceFilePreview
                file={selectedFile}
                onBack={() => setSelectedFile(undefined)}
                onReference={() => {
                  const current = host.composerText.trimEnd();
                  host.setComposerText(`${current}${current.length > 0 ? ' ' : ''}@${selectedFile.relativePath} `);
                  dispatch({ type: 'navigate', route: 'chat' });
                  dispatch({ type: 'toast', message: '已放进砚台，发送时由 Host 读取文件' });
                }}
              />
            ) : (
              directoryView
            )
          )
        ) : state.workspaceTab === '终端' ? (
          <WorkspaceJobs
            client={client}
            sessionId={host.activeSessionId}
            onToast={(message) => dispatch({ type: 'toast', message })}
          />
        ) : state.workspaceTab === '变更' ? (
          <WorkspaceChanges
            client={client}
            projectLocator={session?.projectId}
            projectName={title}
            sessionPaths={sessionChangedPaths(host.messages)}
          />
        ) : state.workspaceTab === '浏览器' ? (
          <WorkspaceBrowser
            client={client}
            sessionId={host.activeSessionId}
            onToast={(message) => dispatch({ type: 'toast', message })}
          />
        ) : state.workspaceTab === '画布' ? (
          <WorkspaceCanvas messages={host.messages} />
        ) : state.workspaceTab === '笔记' ? (
          <ConnectedNoteInspector hostCtx={hostCtx} />
        ) : state.workspaceTab === '卡片' ? (
          <>
            <ScreenHeading title="知识卡片" subtitle="Host 卡片目录独立同步" />
            <p className="muted">请打开知识卡片工作台读取 Host 目录，不在工作区保留固定卡片。</p>
            <FullButton variant="secondary" onClick={go('cards')}>
              打开知识卡片
            </FullButton>
          </>
        ) : (
          <WorkspaceSideChat
            client={client}
            sessionId={host.activeSessionId}
            onOpenSession={(sessionId) => {
              void host.handleSelectSession(sessionId).then(() => dispatch({ type: 'navigate', route: 'chat' }));
            }}
            onToast={(message) => dispatch({ type: 'toast', message })}
          />
        )}
      </div>
    </>
  );
}
