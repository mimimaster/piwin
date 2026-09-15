import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { HostResponse, NoteRecord } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon } from '../icons.js';
import {
  Dot,
  FullButton,
  IconButton,
  ListRow,
  Pill,
  ScreenHeading,
  TabsRow,
  TopBar,
} from '../inkstone-ui.js';
import { DiffCard } from './review.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { createMobileIdempotencyKey, executeMobileMutation } from '../../mobile-prompt-send.js';

function FileRows(): ReactElement {
  const { dispatch } = useInkstone();
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  return (
    <>
      <ListRow
        name="folder"
        title="packages"
        subtitle="Host 的项目文件"
        onClick={openSheet('folder')}
      />
      <ListRow
        name="folder"
        title="apps"
        subtitle="desktop · mobile · cli"
        onClick={openSheet('folder')}
      />
      <ListRow
        name="folder"
        title="docs"
        subtitle="设计、计划与架构"
        onClick={openSheet('folder')}
      />
      <ListRow
        name="file"
        title="session-index.ts"
        subtitle="packages/session/src · 已修改"
        onClick={openSheet('file')}
      />
      <ListRow
        name="file"
        title="draft-store.ts"
        subtitle="packages/session/src · 新增"
        onClick={openSheet('file')}
      />
      <ListRow
        name="file"
        title="README.md"
        subtitle="项目说明 · 4.2 KB"
        onClick={() => dispatch({ type: 'open-workspace', tab: '文档' })}
      />
    </>
  );
}

function NoteInspector(): ReactElement {
  const { state, dispatch } = useInkstone();
  const [text, setText] = useState(state.note);
  return (
    <>
      <ScreenHeading title="随手记" subtitle="与当前会话关联" />
      <label className="field">
        移动端的三点想法
        <textarea rows={9} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'save-note', value: text })}>
        保存笔记
      </FullButton>
      <FullButton
        variant="subtle"
        onClick={() => dispatch({ type: 'add-context', value: '移动端的三点想法' })}
      >
        把笔记加入对话
      </FullButton>
    </>
  );
}

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
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const go = (route: InkstoneRoute) => () => dispatch({ type: 'navigate', route });
  const openSheet = (key: string) => () => dispatch({ type: 'open-sheet', key });
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [state.workspaceTab]);

  if (hostCtx !== null) {
    return <ConnectedWorkspacePage hostCtx={hostCtx} />;
  }

  return (
    <>
      <TopBar
        title="工作区"
        subtitle="piwin · 与当前会话关联"
        onBack={go('chat')}
        right={<IconButton name="plus" label="工作区入口" onClick={openSheet('workspace-menu')} />}
      />
      <TabsRow
        items={WORKSPACE_TABS}
        selected={state.workspaceTab}
        onSelect={(tab) => dispatch({ type: 'workspace-tab', tab })}
        extra="workspace-tabs"
      />
      <div className="screen-scroll" ref={scrollRef}>
        {state.workspaceTab === '文件' ? (
          <>
            <ScreenHeading title="项目文件" subtitle="piwin / main" />
            <FileRows />
          </>
        ) : state.workspaceTab === '终端' ? (
          <>
            <ScreenHeading title="终端输出" subtitle="Host · zsh · 只读快照" />
            <Pill>
              <Dot status="done" />
              退出码 0
            </Pill>
            <pre className="terminal">
              <span className="muted">~/Developer/piwin</span>
              {'\n'}$ pnpm --filter @piwin/session test
              {'\n\n'}
              RUN v3.0.5
              {'\n\n'}
              <span className="green"> ✓ session-index.test.ts (8)</span>
              {'\n'}
              <span className="green"> ✓ draft-store.test.ts (6)</span>
              {'\n\n'}
              {' Test Files  2 passed (2)\n      Tests  14 passed (14)\n   Duration  1.42s\n\n'}
              <span className="muted">输出快照 · 09:38:12</span>
            </pre>
            <FullButton variant="secondary" onClick={openSheet('terminal-command')}>
              请 Agent 执行下一条命令
            </FullButton>
            <div className="quote-note">
              手机查看 Host 上的输出。命令先回到会话，由 Agent 执行。
            </div>
          </>
        ) : state.workspaceTab === '变更' ? (
          <>
            <ScreenHeading title="本轮变更" subtitle="3 个文件 · +48 −12" />
            <DiffCard />
            <FullButton variant="secondary" onClick={go('review')}>
              打开完整审阅
            </FullButton>
          </>
        ) : state.workspaceTab === '浏览器' ? (
          <>
            <ScreenHeading title="Host 浏览器" subtitle="当前标签页 · 预览快照" />
            <div className="search-field">
              <Icon name="globe" />
              <span className="mono" style={{ fontSize: 11 }}>
                localhost:5173
              </span>
            </div>
            <div className="note-paper">
              <span className="eyebrow">PIWIN / INKSTONE</span>
              <h3 style={{ marginTop: 20 }}>一张纸，一块砚。</h3>
              <p>让思路有安放的地方。</p>
              <hr />
              <p>会话 · 项目 · 案头</p>
              <Pill variant="pine" style={{ marginTop: 20 }}>
                示例页面快照
              </Pill>
            </div>
            <FullButton
              variant="secondary"
              onClick={() => dispatch({ type: 'add-context', value: '浏览器页面快照' })}
            >
              把页面加入对话
            </FullButton>
            <ListRow
              name="term"
              title="控制台"
              subtitle="0 条错误 · 查看示例输出"
              onClick={openSheet('console')}
            />
          </>
        ) : state.workspaceTab === '画布' ? (
          <>
            <ScreenHeading title="Artifact 画布" subtitle="阅读预览 · 按需查看源码" />
            <div className="note-paper">
              <span className="eyebrow">SESSION MEMORY / 01</span>
              <h3 style={{ marginTop: 20 }}>一份安静的记忆</h3>
              <p>
                会话内容交给 Host，
                <br />
                阅读位置留在设备，
                <br />
                每次回来，都从这里开始。
              </p>
              <hr />
              <div className="spread">
                <Pill>Host · 会话</Pill>→<Pill>设备 · 视图</Pill>
              </div>
            </div>
            <FullButton variant="secondary" onClick={openSheet('artifact-source')}>
              查看源码
            </FullButton>
            <p className="muted" style={{ fontSize: 11, marginTop: 16 }}>
              原型为静态画布。产品中的 Artifact 使用隔离预览。
            </p>
          </>
        ) : state.workspaceTab === '文档' ? (
          <>
            <ScreenHeading title="会话记忆设计" subtitle="session-memory.md · 阅读模式" />
            <article className="note-paper">
              <span className="eyebrow">设计笔记 / 2026.09</span>
              <h3 style={{ marginTop: 18 }}>
                恢复的是思路，
                <br />
                也是上下文。
              </h3>
              <p>
                同一个会话可以在不同的设备继续。手机带走的是观察和输入的能力，执行仍然留在 Host。
              </p>
              <hr />
              <p>
                一、先恢复历史与草稿。
                <br />
                二、再接上最新的活动。
                <br />
                三、不重复发送旧的命令。
              </p>
            </article>
            <FullButton
              variant="secondary"
              onClick={() =>
                dispatch({ type: 'add-context', value: 'session-memory.md · 恢复设计' })
              }
            >
              引用这段到会话
            </FullButton>
          </>
        ) : state.workspaceTab === '笔记' ? (
          <NoteInspector />
        ) : state.workspaceTab === '卡片' ? (
          <>
            <ScreenHeading title="本次对话的卡片" subtitle="3 张 · 架构与设计" />
            <ListRow
              name="cards"
              title="Host 为什么是唯一权威？"
              subtitle="翻面、浏览或加入计划复习"
              onClick={go('cards')}
            />
            <ListRow
              name="cards"
              title="阅读状态由谁记录？"
              subtitle="来自本轮会话"
              onClick={go('cards')}
            />
            <FullButton variant="secondary" onClick={go('cards')}>
              打开知识卡片
            </FullButton>
          </>
        ) : (
          <>
            <ScreenHeading title="另起一页，问个细节。" subtitle="关联当前会话 · 不干扰主任务" />
            <div className="quote-note">“Host 记住会话本身，设备记住你阅读的位置。”</div>
            <div className="user-message">为什么阅读位置不也放在 Host？</div>
            <div className="assistant-prose" style={{ marginTop: 20 }}>
              <p>因为两台设备可能正在读不同的地方。正文共享，视图独立，就不会相互打断。</p>
            </div>
            <FullButton
              variant="secondary"
              onClick={() =>
                dispatch({ type: 'add-context', value: '侧聊结论：正文共享，视图独立。' })
              }
            >
              把这段结论带回主会话
            </FullButton>
          </>
        )}
      </div>
    </>
  );
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

function readWorkspaceFile(response: HostResponse): { content: string; truncated: boolean } | undefined {
  if (!response.success || !isRecord(response.data) || typeof response.data.content !== 'string') {
    return undefined;
  }
  return {
    content: response.data.content,
    truncated: response.data.truncated === true,
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
  const [selectedFile, setSelectedFile] = useState<{ path: string; content: string; truncated: boolean }>();
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
    setSelectedFile({ path: entry.relativePath, ...file });
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
      {selectedFile !== undefined ? (
        <article className="note-paper">
          <span className="eyebrow mono">{selectedFile.path}</span>
          <pre className="terminal">{selectedFile.content}</pre>
          {selectedFile.truncated ? <p className="muted">内容已按 Host 上限截断。</p> : null}
          <FullButton
            variant="secondary"
            onClick={() => dispatch({ type: 'add-context', value: `@${selectedFile.path}` })}
          >
            引用到对话
          </FullButton>
        </article>
      ) : null}
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
            directoryView
          )
        ) : state.workspaceTab === '终端' ? (
          <>
            <ScreenHeading title="Host 运行状态" subtitle="移动端只展示 Host 返回的活动摘要" />
            {host.activityItems.length === 0 ? (
              <p className="muted">当前没有运行中的 Host 任务或待处理权限。</p>
            ) : (
              host.activityItems.map((item) => (
                <ListRow
                  key={`${item.sessionId}-${item.runId ?? item.permissionRequestId ?? 'activity'}`}
                  name="term"
                  title={item.runId ? `运行 ${item.runId}` : '等待权限'}
                  subtitle={item.phase ?? item.permissionAction ?? item.status ?? 'Host 活动'}
                  onClick={go('activity')}
                />
              ))
            )}
            <FullButton variant="secondary" onClick={go('activity')}>
              查看完整活动
            </FullButton>
          </>
        ) : state.workspaceTab === '变更' ? (
          <>
            <ScreenHeading title="Host 变更" subtitle="进入审阅页读取当前子任务结果" />
            <p className="muted">此处不再显示固定 Diff；审阅页会按结果版本加载文件和补丁。</p>
            <FullButton variant="secondary" onClick={go('review')}>
              打开完整审阅
            </FullButton>
          </>
        ) : state.workspaceTab === '浏览器' ? (
          <>
            <ScreenHeading title="Host 浏览器" subtitle="由 Host 浏览器会话提供快照" />
            {client?.supportsCommand('browser/start') ? (
              <p className="muted">Host 已声明浏览器能力；当前壳尚未订阅浏览器帧。</p>
            ) : (
              <p className="muted">当前 Host 未开放浏览器控制。</p>
            )}
          </>
        ) : state.workspaceTab === '画布' ? (
          <>
            <ScreenHeading title="Artifact 画布" subtitle="从当前会话消息打开真实预览" />
            <p className="muted">画布内容由 Host 消息中的 Artifact 载荷提供；当前会话没有可独立展示的画布。</p>
            <FullButton variant="secondary" onClick={go('chat')}>
              回到对话查看 Artifact
            </FullButton>
          </>
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
          <>
            <ScreenHeading title="侧聊" subtitle="关联当前 Host 会话" />
            <p className="muted">侧聊消息需要 Host 提供独立会话；当前壳不会伪造一段回答。</p>
            <FullButton variant="secondary" onClick={go('chat')}>
              回到主会话
            </FullButton>
          </>
        )}
      </div>
    </>
  );
}
