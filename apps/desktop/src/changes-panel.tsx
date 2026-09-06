/**
 * Uncommitted file list & in-tab review — VS Code / Cursor SCM style.
 * Selecting a file switches into in-tab diff review without opening a separate Document tab.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { GitDiffSummary, GitStatusSnapshot, HostResponse } from '@piwin/contracts';
import { Button, FileTypeIcon, Notice } from '@piwin/ui-kit';
import { IconRefresh } from './shell-icons';
import { useConfirmDialog } from './use-confirm-dialog';
import { formatDisplayPathParts } from './truncate-relative-path';
import { ChangeFileReview } from './change-file-review';

type GitReadRequest =
  | { type: 'git/status'; projectPath: string }
  | { type: 'git/diff-summary'; projectPath: string }
  | {
      type: 'git/diff-file';
      projectPath: string;
      path: string;
      scope?: 'worktree' | 'staged' | 'combined';
    }
  | {
      type: 'git/stage';
      input: { projectPath: string; paths: string[] };
    }
  | {
      type: 'git/unstage';
      input: { projectPath: string; paths: string[] };
    }
  | {
      type: 'git/commit';
      input: { projectPath: string; message: string; allTracked?: boolean };
    };

export type ChangesPanelProps = {
  projectPath: string | null;
  request: (command: GitReadRequest) => Promise<HostResponse>;
  locale?: 'zh-CN' | 'en' | undefined;
  /** @deprecated Kept for backwards compatibility; file clicks now review within the Changes tab. */
  onOpenFile?: (absolutePath: string, relativePath: string) => void;
};

type ChangeRow = {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  additions: number;
  deletions: number;
};

function statusShort(status: string): string {
  switch (status) {
    case 'modified':
      return 'M';
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    case 'untracked':
      return 'U';
    case 'conflicted':
      return 'C';
    default:
      return status.slice(0, 1).toUpperCase() || '?';
  }
}

function ChangeFileRow(props: {
  row: ChangeRow;
  selected: boolean;
  checked: boolean;
  projectPath: string | null;
  onToggleChecked: (path: string) => void;
  onSelect: (path: string) => void;
}): ReactElement {
  const parts = formatDisplayPathParts(props.row.path, props.projectPath);
  return (
    <li>
      <div
        className={props.selected ? 'changes-row selected' : 'changes-row'}
        data-testid="changes-row"
      >
        <input
          type="checkbox"
          className="changes-check"
          checked={props.checked}
          onChange={() => props.onToggleChecked(props.row.path)}
          aria-label={`Select ${props.row.path} for stage`}
          onClick={(event) => event.stopPropagation()}
        />
        <button
          type="button"
          className="changes-row-main"
          onClick={() => props.onSelect(props.row.path)}
        >
          <FileTypeIcon filePathOrExt={props.row.path} className="changes-row-icon" />
          <span className={`changes-code status-${props.row.status}`}>
            {statusShort(props.row.status)}
          </span>
          <span className="changes-path" title={props.row.path}>
            {parts.dirPath ? <span className="changes-path-dir">{parts.dirPath}</span> : null}
            <span className="changes-path-file">{parts.fileName}</span>
          </span>
          <span className="changes-stats">
            {props.row.additions > 0 ? <span className="add">+{props.row.additions}</span> : null}
            {props.row.deletions > 0 ? <span className="del">−{props.row.deletions}</span> : null}
          </span>
          {props.row.staged ? <span className="changes-chip" title="staged">S</span> : null}
        </button>
      </div>
    </li>
  );
}

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  const confirmDialog = useConfirmDialog();
  const locale = props.locale ?? 'zh-CN';
  const [snapshot, setSnapshot] = useState<GitStatusSnapshot | null>(null);
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [checkedPaths, setCheckedPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!props.projectPath) {
      setSnapshot(null);
      setDiff(null);
      setError(null);
      setActivePath(null);
      return;
    }
    setLoading(true);
    setError(null);
    const path = props.projectPath;
    const [statusResponse, diffResponse] = await Promise.all([
      props.request({ type: 'git/status', projectPath: path }),
      props.request({ type: 'git/diff-summary', projectPath: path }),
    ]);
    setLoading(false);
    if (!statusResponse.success) {
      setError(statusResponse.error);
      return;
    }
    const nextStatus = (statusResponse.data as { snapshot: GitStatusSnapshot }).snapshot;
    setSnapshot(nextStatus);
    if (diffResponse.success) {
      setDiff((diffResponse.data as { summary: GitDiffSummary }).summary);
    } else {
      // Status is the source of truth for the file list. A diff summary can
      // fail for binary/untracked files without hiding the changed files.
      setDiff(null);
    }
    setCheckedPaths((current) =>
      current.filter((filePath) => nextStatus.changedFiles.some((file) => file.path === filePath)),
    );
    setActivePath((current) => {
      if (current && nextStatus.changedFiles.some((file) => file.path === current)) {
        return current;
      }
      return nextStatus.changedFiles[0]?.path ?? null;
    });
    // Depend on the fields, not the props object: the parent re-renders on
    // every composer keystroke, and a new props identity here used to re-run
    // this effect per keystroke — flashing "Loading", spamming git requests,
    // and shaking the open right panel.
  }, [props.projectPath, props.request]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const rows: ChangeRow[] = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const statsByPath = new Map(
      (diff?.files ?? []).map((file) => [
        file.path,
        { additions: file.additions, deletions: file.deletions },
      ]),
    );
    return snapshot.changedFiles.map((file) => {
      const stats = statsByPath.get(file.path);
      return {
        path: file.path,
        status: file.status,
        staged: file.staged,
        unstaged: file.unstaged,
        additions: stats?.additions ?? 0,
        deletions: stats?.deletions ?? 0,
      };
    });
  }, [snapshot, diff]);

  const activeRow = useMemo(
    () => rows.find((r) => r.path === activePath),
    [rows, activePath],
  );

  const stagedCount = useMemo(() => rows.filter((r) => r.staged).length, [rows]);

  function toggleChecked(filePath: string): void {
    setCheckedPaths((current) =>
      current.includes(filePath)
        ? current.filter((item) => item !== filePath)
        : [...current, filePath],
    );
  }

  async function runStage(kind: 'stage' | 'unstage'): Promise<void> {
    if (!props.projectPath) {
      return;
    }
    const paths = checkedPaths;
    const label =
      paths.length === 0
        ? kind === 'stage'
          ? locale === 'zh-CN' ? '暂存所有变更？' : 'Stage ALL changes?'
          : locale === 'zh-CN' ? '取消暂存所有已暂存文件？' : 'Unstage ALL staged changes?'
        : `${kind === 'stage' ? (locale === 'zh-CN' ? '暂存' : 'Stage') : (locale === 'zh-CN' ? '取消暂存' : 'Unstage')} ${paths.length} ${locale === 'zh-CN' ? '个文件' : 'path(s)'}?`;
    const ok = await confirmDialog.confirm({
      title: kind === 'stage' ? (locale === 'zh-CN' ? '暂存变更？' : 'Stage changes?') : (locale === 'zh-CN' ? '取消暂存？' : 'Unstage changes?'),
      description: label,
      confirmLabel: kind === 'stage' ? (locale === 'zh-CN' ? '暂存' : 'Stage') : (locale === 'zh-CN' ? '取消暂存' : 'Unstage'),
      tone: 'default',
    });
    if (!ok) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({
      type: kind === 'stage' ? 'git/stage' : 'git/unstage',
      input: { projectPath: props.projectPath, paths },
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(kind === 'stage' ? (locale === 'zh-CN' ? '已暂存' : 'Staged') : (locale === 'zh-CN' ? '已取消暂存' : 'Unstaged'));
    await reload();
  }

  async function runCommit(): Promise<void> {
    if (!props.projectPath || !commitMessage.trim()) {
      return;
    }
    const ok = await confirmDialog.confirm({
      title: locale === 'zh-CN' ? '确认提交' : 'Confirm commit',
      description: commitMessage.trim(),
      confirmLabel: locale === 'zh-CN' ? '提交' : 'Commit',
      tone: 'default',
    });
    if (!ok) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request({
      type: 'git/commit',
      input: { projectPath: props.projectPath, message: commitMessage.trim() },
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setCommitMessage('');
    setInfo(locale === 'zh-CN' ? '已提交' : 'Committed');
    await reload();
  }

  if (!props.projectPath) {
    return (
      <>
        {confirmDialog.dialog}
        <div className="changes-panel" data-testid="changes-panel">
          <div className="right-panel-empty muted">
            {locale === 'zh-CN' ? '打开项目查看文件变更' : 'Open a project to see file changes.'}
          </div>
        </div>
      </>
    );
  }

  const branchLabel = snapshot?.branch
    ? snapshot.branch.isDetached
      ? `detached @ ${snapshot.branch.headCommit?.slice(0, 7) ?? '?'}`
      : (snapshot.branch.currentBranch ?? 'unknown')
    : '…';

  const branchUpstream = snapshot?.branch?.upstreamBranch
    ? ` · ${snapshot.branch.upstreamBranch} ↑${snapshot.branch.ahead} ↓${snapshot.branch.behind}`
    : '';

  return (
    <>
      {confirmDialog.dialog}
      <div
        className={
          activePath
            ? 'changes-panel changes-panel-list changes-panel-stacked'
            : 'changes-panel changes-panel-list'
        }
        data-testid="changes-panel"
      >
        <div className="changes-list-pane">
          <div className="changes-toolbar">
            <div className="changes-toolbar-heading">
              <strong>{locale === 'zh-CN' ? '未提交变更' : 'Uncommitted changes'}</strong>
              <div className="changes-branch muted" title={branchLabel + branchUpstream}>
                <span
                  className={snapshot?.branch?.dirty ? 'changes-branch-dot dirty' : 'changes-branch-dot'}
                  aria-hidden
                />
                {branchLabel}{branchUpstream}
              </div>
            </div>
            <button
              type="button"
              className="changes-icon-button"
              disabled={loading || busy}
              onClick={() => void reload()}
              title={locale === 'zh-CN' ? '刷新变更' : 'Refresh changes'}
              aria-label={locale === 'zh-CN' ? '刷新变更' : 'Refresh changes'}
            >
              <IconRefresh />
            </button>
          </div>

          {error ? <Notice tone="error">{error}</Notice> : null}
          {info ? <Notice tone="info">{info}</Notice> : null}

          {!snapshot?.repository.isRepository ? (
            <div className="right-panel-empty muted">
              {locale === 'zh-CN' ? '非 Git 仓库' : 'Not a git repository.'}
            </div>
          ) : rows.length === 0 ? (
            <div className="right-panel-empty muted" data-testid="changes-clean">
              {locale === 'zh-CN' ? '工作区干净' : 'Working tree clean'}
              {diff ? (
                <div className="changes-totals muted">
                  +{diff.totalAdditions} / −{diff.totalDeletions}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {/* proto-04 b08: one flat list — staged rows carry an S chip, no section headers */}
              <ul className="changes-list" data-testid="changes-list" data-changes-count={rows.length}>
                {rows.map((row) => (
                  <ChangeFileRow
                    key={row.path}
                    row={row}
                    selected={activePath === row.path}
                    checked={checkedPaths.includes(row.path)}
                    projectPath={props.projectPath}
                    onToggleChecked={toggleChecked}
                    onSelect={setActivePath}
                  />
                ))}
              </ul>

              {activePath && props.projectPath ? (
                <ChangeFileReview
                  projectPath={props.projectPath}
                  relativePath={activePath}
                  status={activeRow?.status}
                  additions={activeRow?.additions}
                  deletions={activeRow?.deletions}
                  request={props.request}
                  locale={props.locale}
                  onBack={() => setActivePath(null)}
                />
              ) : null}

              {/* Integrated Commit & Stage Bar */}
              <div className="changes-commit-bar" data-testid="changes-commit-bar">
                <div className="changes-commit-hint">
                  <span>
                    {locale === 'zh-CN' ? (
                      <>
                        已暂存 <b>{stagedCount}</b> / 共 {rows.length}
                      </>
                    ) : (
                      <>
                        Staged <b>{stagedCount}</b> / {rows.length}
                      </>
                    )}
                  </span>
                  <div className="changes-stage-links">
                    <button
                      type="button"
                      className="changes-link-btn"
                      disabled={busy}
                      onClick={() => void runStage('stage')}
                    >
                      {locale === 'zh-CN'
                        ? (checkedPaths.length > 0 ? '暂存所选' : '暂存全部')
                        : (checkedPaths.length > 0 ? 'Stage selected' : 'Stage all')}
                    </button>
                    <button
                      type="button"
                      className="changes-link-btn"
                      disabled={busy || stagedCount === 0}
                      onClick={() => void runStage('unstage')}
                    >
                      {locale === 'zh-CN'
                        ? (checkedPaths.length > 0 ? '取消暂存' : '全部取消')
                        : (checkedPaths.length > 0 ? 'Unstage selected' : 'Unstage all')}
                    </button>
                  </div>
                </div>
                <div className="changes-commit-line">
                  <input
                    type="text"
                    className="changes-commit-input"
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder={locale === 'zh-CN' ? '输入提交信息…' : 'Commit message…'}
                    data-testid="changes-commit-message"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && commitMessage.trim() && stagedCount > 0 && !busy) {
                        void runCommit();
                      }
                    }}
                  />
                  <Button
                    size="compact"
                    variant="primary"
                    disabled={busy || !commitMessage.trim() || stagedCount === 0}
                    onClick={() => void runCommit()}
                    data-testid="changes-commit-btn"
                  >
                    {locale === 'zh-CN' ? '提交' : 'Commit'}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
