/**
 * Uncommitted file list — VS Code SCM style.
 * Selecting a file delegates to the shared workspace file preview instead of
 * maintaining a second diff/document surface inside the Changes tab.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { GitDiffSummary, GitStatusSnapshot, HostResponse } from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';
import { IconRefresh } from './shell-icons';
import { useConfirmDialog } from './use-confirm-dialog';

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
    };

export type ChangesPanelProps = {
  projectPath: string | null;
  request: (command: GitReadRequest) => Promise<HostResponse>;
  /** Open a changed file through the shared workspace file-preview flow. */
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

export function ChangesPanel(props: ChangesPanelProps): ReactElement {
  const confirmDialog = useConfirmDialog();
  const [snapshot, setSnapshot] = useState<GitStatusSnapshot | null>(null);
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [checkedPaths, setCheckedPaths] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
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
  }, [props]);

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
          ? 'Stage ALL changes?'
          : 'Unstage ALL staged changes?'
        : `${kind === 'stage' ? 'Stage' : 'Unstage'} ${paths.length} path(s)?`;
    const ok = await confirmDialog.confirm({
      title: kind === 'stage' ? 'Stage changes?' : 'Unstage changes?',
      description: label,
      confirmLabel: kind === 'stage' ? 'Stage' : 'Unstage',
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
    setInfo(kind === 'stage' ? 'Staged' : 'Unstaged');
    await reload();
  }

  function absolutePathFor(relativePath: string): string {
    if (!props.projectPath) {
      return relativePath;
    }
    const projectPath = props.projectPath.replace(/[\\/]+$/, '');
    return `${projectPath}/${relativePath}`;
  }

  if (!props.projectPath) {
    return (
      <>
        {confirmDialog.dialog}
        <div className="changes-panel" data-testid="changes-panel">
          <div className="right-panel-empty muted">Open a project to see file changes.</div>
        </div>
      </>
    );
  }

  const branchLabel = snapshot?.branch
    ? snapshot.branch.isDetached
      ? `detached @ ${snapshot.branch.headCommit?.slice(0, 7) ?? '?'}`
      : (snapshot.branch.currentBranch ?? 'unknown')
    : '…';

  return (
    <>
      {confirmDialog.dialog}
      <div className="changes-panel changes-panel-list" data-testid="changes-panel">
        <div className="changes-list-pane">
          <div className="changes-toolbar">
            <div className="changes-toolbar-heading">
              <strong>Uncommitted changes</strong>
              <div className="changes-branch muted" title={branchLabel}>
                <span className="changes-branch-dot" aria-hidden />
                {branchLabel}
              </div>
            </div>
            <button
              type="button"
              className="changes-icon-button"
              disabled={loading || busy}
              onClick={() => void reload()}
              title="Refresh changes"
              aria-label="Refresh changes"
            >
              <IconRefresh />
            </button>
          </div>

          {error ? <Notice tone="error">{error}</Notice> : null}
          {info ? <Notice tone="info">{info}</Notice> : null}

          {!snapshot?.repository.isRepository ? (
            <div className="right-panel-empty muted">Not a git repository.</div>
          ) : rows.length === 0 ? (
            <div className="right-panel-empty muted" data-testid="changes-clean">
              Working tree clean
              {diff ? (
                <div className="changes-totals muted">
                  +{diff.totalAdditions} / −{diff.totalDeletions}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="changes-totals muted" data-testid="changes-count">
                {rows.length} file{rows.length === 1 ? '' : 's'}
                {diff ? ` · +${diff.totalAdditions} −${diff.totalDeletions}` : ''}
              </div>
              <ul className="changes-list" data-testid="changes-list">
                {rows.map((row) => (
                  <li key={row.path}>
                    <div
                      className={activePath === row.path ? 'changes-row selected' : 'changes-row'}
                      data-testid="changes-row"
                    >
                      <input
                        type="checkbox"
                        className="changes-check"
                        checked={checkedPaths.includes(row.path)}
                        onChange={() => toggleChecked(row.path)}
                        aria-label={`Select ${row.path} for stage`}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <button
                        type="button"
                        className="changes-row-main"
                        onClick={() => {
                          setActivePath(row.path);
                          props.onOpenFile?.(absolutePathFor(row.path), row.path);
                        }}
                      >
                        <span className={`changes-code status-${row.status}`}>
                          {statusShort(row.status)}
                        </span>
                        <span className="changes-path" title={row.path}>
                          {row.path}
                        </span>
                        <span className="changes-stats">
                          {row.additions > 0 ? <span className="add">+{row.additions}</span> : null}
                          {row.deletions > 0 ? <span className="del">−{row.deletions}</span> : null}
                        </span>
                        {row.staged ? <span className="changes-chip">S</span> : null}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="changes-actions">
                <Button size="compact" disabled={busy} onClick={() => void runStage('stage')}>
                  Stage {checkedPaths.length > 0 ? 'selected' : 'all'}
                </Button>
                <Button size="compact" disabled={busy} onClick={() => void runStage('unstage')}>
                  Unstage {checkedPaths.length > 0 ? 'selected' : 'all'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
