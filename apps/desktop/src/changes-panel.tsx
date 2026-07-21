/**
 * Changes file list — adapted from cdesktop ChangesPanel / FileTree pattern:
 * path + status + +/- stats, staged chips, quick stage actions.
 * Data from piwin git/status + git/diff-summary IPC.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type {
  GitDiffSummary,
  GitStatusSnapshot,
  HostResponse,
} from '@piwin/contracts';
import { IconRefresh } from './shell-icons';

type GitReadRequest =
  | { type: 'git/status'; projectPath: string }
  | { type: 'git/diff-summary'; projectPath: string }
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
  const [snapshot, setSnapshot] = useState<GitStatusSnapshot | null>(null);
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!props.projectPath) {
      setSnapshot(null);
      setDiff(null);
      setError(null);
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
    if (!diffResponse.success) {
      setError(diffResponse.error);
      return;
    }
    const nextStatus = (statusResponse.data as { snapshot: GitStatusSnapshot }).snapshot;
    const nextDiff = (diffResponse.data as { summary: GitDiffSummary }).summary;
    setSnapshot(nextStatus);
    setDiff(nextDiff);
    setSelectedPaths((current) =>
      current.filter((filePath) =>
        nextStatus.changedFiles.some((file) => file.path === filePath),
      ),
    );
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

  function togglePath(filePath: string): void {
    setSelectedPaths((current) =>
      current.includes(filePath)
        ? current.filter((item) => item !== filePath)
        : [...current, filePath],
    );
  }

  async function runStage(kind: 'stage' | 'unstage'): Promise<void> {
    if (!props.projectPath) {
      return;
    }
    const paths = selectedPaths;
    const label =
      paths.length === 0
        ? kind === 'stage'
          ? 'Stage ALL changes?'
          : 'Unstage ALL staged changes?'
        : `${kind === 'stage' ? 'Stage' : 'Unstage'} ${paths.length} path(s)?`;
    if (!window.confirm(label)) {
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

  if (!props.projectPath) {
    return (
      <div className="changes-panel" data-testid="changes-panel">
        <div className="right-panel-empty muted">Open a project to see file changes.</div>
      </div>
    );
  }

  const branchLabel = snapshot?.branch
    ? snapshot.branch.isDetached
      ? `detached @ ${snapshot.branch.headCommit?.slice(0, 7) ?? '?'}`
      : snapshot.branch.currentBranch ?? 'unknown'
    : '…';

  return (
    <div className="changes-panel" data-testid="changes-panel">
      <div className="changes-toolbar">
        <div className="changes-branch muted" title={branchLabel}>
          <span className="changes-branch-dot" aria-hidden />
          {branchLabel}
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

      {error ? <div className="error-banner">{error}</div> : null}
      {info ? <div className="muted changes-info">{info}</div> : null}

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
          <div className="changes-totals muted">
            {rows.length} file{rows.length === 1 ? '' : 's'}
            {diff ? ` · +${diff.totalAdditions} −${diff.totalDeletions}` : ''}
          </div>
          <ul className="changes-list" data-testid="changes-list">
            {rows.map((row) => (
              <li key={row.path}>
                <button
                  type="button"
                  className={
                    selectedPaths.includes(row.path)
                      ? 'changes-row selected'
                      : 'changes-row'
                  }
                  onClick={() => togglePath(row.path)}
                  data-testid="changes-row"
                >
                  <span className={`changes-code status-${row.status}`}>
                    {statusShort(row.status)}
                  </span>
                  <span className="changes-path" title={row.path}>
                    {row.path}
                  </span>
                  <span className="changes-stats">
                    {row.additions > 0 ? (
                      <span className="add">+{row.additions}</span>
                    ) : null}
                    {row.deletions > 0 ? (
                      <span className="del">−{row.deletions}</span>
                    ) : null}
                  </span>
                  {row.staged ? <span className="changes-chip">S</span> : null}
                </button>
              </li>
            ))}
          </ul>
          <div className="changes-actions">
            <button
              type="button"
              className="btn btn-compact"
              disabled={busy}
              onClick={() => void runStage('stage')}
            >
              Stage {selectedPaths.length > 0 ? 'selected' : 'all'}
            </button>
            <button
              type="button"
              className="btn btn-compact"
              disabled={busy}
              onClick={() => void runStage('unstage')}
            >
              Unstage {selectedPaths.length > 0 ? 'selected' : 'all'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
