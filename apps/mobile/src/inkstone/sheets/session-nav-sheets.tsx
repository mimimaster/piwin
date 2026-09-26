import { useEffect, useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import type {
  HostResponse,
  RemoteSessionSummary,
  SessionSearchResult,
} from '@piwin/contracts';
import { isRecord } from '../../mobile-host-helpers.js';
import { useInkstone } from '../inkstone-context.js';
import { ListRow } from '../inkstone-ui.js';
import { Icon } from '../icons.js';
import { cleanSessionPreview, formatClock } from '../host/host-bridge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { blockedByOfflineSnapshot } from '../host/offline-guard.js';

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

/** Where a new Agent draft will run; picking only updates the draft. */
export function DraftProjectSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  const { state, dispatch } = useInkstone();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  const { host } = hostCtx;
  return (
    <>
      {host.projects.map((project) => (
        <ListRow
          key={project.projectId}
          name="folder"
          title={project.displayName}
          {...(project.currentBranch === undefined ? {} : { subtitle: project.currentBranch })}
          selected={state.draft?.projectId === project.projectId}
          onClick={() => dispatch({ type: 'set-draft-project', projectId: project.projectId })}
        />
      ))}
      {host.projects.length === 0 ? (
        <p className="muted">Host 上还没有项目。先在桌面端添加项目；现在发送会按普通对话开始。</p>
      ) : null}
    </>
  );
}

export function ProjectsSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedProjectsSheet hostCtx={hostCtx} />;
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
    if (workingProjectId !== undefined || blockedByOfflineSnapshot(hostCtx, dispatch)) return;
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
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedWorkspacePickerSheet hostCtx={hostCtx} />;
}

function ConnectedWorkspacePickerSheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const openProject = async (projectId: string): Promise<void> => {
    if (blockedByOfflineSnapshot(hostCtx, dispatch)) return;
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

export function SearchSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedSearchSheet hostCtx={hostCtx} />;
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
    if (blockedByOfflineSnapshot(hostCtx, dispatch)) return;
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
