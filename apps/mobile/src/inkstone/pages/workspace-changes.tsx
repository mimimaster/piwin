import { useEffect, useState, type ReactElement } from 'react';
import type { GitDiffSummary, GitFileDiff, GitFileStatusCode } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { FullButton, ScreenHeading } from '../inkstone-ui.js';
import { MobileDiffViewer } from '../../components/chat/MobileDiffViewer.js';

const STATUS_LETTER: Record<GitFileStatusCode, string> = {
  untracked: 'U',
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  conflicted: '!',
  unknown: '?',
};

type DiffState =
  | { kind: 'idle' }
  | { kind: 'loading'; path: string }
  | { kind: 'ready'; diff: GitFileDiff }
  | { kind: 'error'; path: string; message: string };

/**
 * Workspace › 变更: the project's working tree against HEAD, read from the
 * Host (`git/diff-summary`, `git/diff-file`). Files the current session wrote
 * are marked so a phone review starts where the agent worked.
 */
export function WorkspaceChanges({
  client,
  projectLocator,
  projectName,
  sessionPaths,
}: {
  client: HostClient | undefined;
  projectLocator: string | undefined;
  projectName: string;
  sessionPaths: readonly string[];
}): ReactElement {
  const [summary, setSummary] = useState<GitDiffSummary | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [diff, setDiff] = useState<DiffState>({ kind: 'idle' });

  useEffect(() => {
    if (client === undefined || projectLocator === undefined) return;
    if (!client.supportsCommand('git/diff-summary')) {
      setError('当前 Host 未开放 Git 变更读取。');
      return;
    }
    let cancelled = false;
    setLoading(true);
    client
      .request({ type: 'git/diff-summary', projectPath: projectLocator })
      .then((response) => {
        if (cancelled) return;
        const data = unwrap(response.success ? response.data : undefined, 'summary');
        if (response.success && isDiffSummary(data)) {
          setSummary(data);
          setError(undefined);
        } else {
          setError(response.success ? 'Host 返回了无法识别的变更数据。' : response.error);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : '读取变更失败。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, projectLocator, reloadKey]);

  const openDiff = (path: string): void => {
    if (client === undefined || projectLocator === undefined) return;
    if (diff.kind === 'ready' && diff.diff.path === path) {
      setDiff({ kind: 'idle' });
      return;
    }
    setDiff({ kind: 'loading', path });
    client
      .request({ type: 'git/diff-file', projectPath: projectLocator, path })
      .then((response) => {
        const data = unwrap(response.success ? response.data : undefined, 'diff');
        if (response.success && isFileDiff(data)) {
          setDiff({ kind: 'ready', diff: data });
        } else {
          setDiff({ kind: 'error', path, message: response.success ? '无法识别的补丁。' : response.error });
        }
      })
      .catch((reason: unknown) => {
        setDiff({ kind: 'error', path, message: reason instanceof Error ? reason.message : '读取补丁失败。' });
      });
  };

  if (projectLocator === undefined) {
    return <ScreenHeading title="没有可审阅的项目" subtitle="当前会话未绑定项目" />;
  }
  if (summary !== undefined && !summary.repository.isRepository) {
    return (
      <>
        <ScreenHeading title="不是 Git 仓库" subtitle={projectName} />
        <p className="muted">这个项目没有 Git 基线，Host 无法给出差异。本轮写入的文件仍会在对话的变更条里列出。</p>
      </>
    );
  }

  const openPath = diff.kind === 'idle' ? undefined : diff.kind === 'ready' ? diff.diff.path : diff.path;
  return (
    <>
      <ScreenHeading
        title="未提交的变更"
        subtitle={
          summary === undefined
            ? projectName
            : `${summary.totalFiles} 个文件 · +${summary.totalAdditions} −${summary.totalDeletions}`
        }
      />
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      {loading && summary === undefined ? <p className="muted">正在向 Host 读取变更…</p> : null}
      {summary !== undefined && summary.files.length === 0 ? <p className="muted">工作区是干净的。</p> : null}
      <div className="change-list">
        {summary?.files.map((file) => {
          const open = openPath === file.path;
          return (
            <div key={file.path}>
              <button className="change-row" type="button" aria-expanded={open} onClick={() => openDiff(file.path)}>
                <span className={`status ${STATUS_LETTER[file.status]}`}>{STATUS_LETTER[file.status]}</span>
                <span className="path">{file.path}</span>
                {touchedBySession(file.path, sessionPaths) ? <span className="session-mark">本会话</span> : null}
                <span className="pm">
                  <span className="plus">+{file.additions}</span> <span className="minus">−{file.deletions}</span>
                </span>
              </button>
              {open ? (
                <div className="change-diff">
                  {diff.kind === 'loading' ? <p className="muted">正在读取补丁…</p> : null}
                  {diff.kind === 'error' ? <p className="error-text">{diff.message}</p> : null}
                  {diff.kind === 'ready' ? (
                    diff.diff.isBinary ? (
                      <p className="muted">二进制文件，不显示补丁。</p>
                    ) : diff.diff.patch.trim().length === 0 ? (
                      <p className="muted">没有文本差异（可能是新文件未跟踪或仅权限变化）。</p>
                    ) : (
                      <>
                        <MobileDiffViewer diffText={diff.diff.patch} />
                        {diff.diff.truncated ? <p className="muted">补丁较大，已按 Host 上限截断。</p> : null}
                      </>
                    )
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {summary?.truncated === true ? <p className="muted">文件较多，只显示前 {summary.files.length} 个。</p> : null}
      <FullButton variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>
        刷新
      </FullButton>
    </>
  );
}

/** Tool paths may be absolute on the Host while git paths are repo-relative. */
function touchedBySession(repoPath: string, sessionPaths: readonly string[]): boolean {
  return sessionPaths.some((path) => path === repoPath || path.endsWith(`/${repoPath}`));
}

/** Host git responses wrap the payload (`{ summary }` / `{ diff }`). */
function unwrap(data: unknown, key: 'summary' | 'diff'): unknown {
  return typeof data === 'object' && data !== null && key in data ? (data as Record<string, unknown>)[key] : data;
}

function isDiffSummary(value: unknown): value is GitDiffSummary {
  return typeof value === 'object' && value !== null && Array.isArray((value as { files?: unknown }).files);
}

function isFileDiff(value: unknown): value is GitFileDiff {
  return typeof value === 'object' && value !== null && typeof (value as { patch?: unknown }).patch === 'string';
}
