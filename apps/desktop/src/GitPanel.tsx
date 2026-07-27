import { useCallback, useEffect, useState } from 'react';
import type {
  GitCommitGraph,
  GitCommitGraphNode,
  GitDiffSummary,
  GitMutationResult,
  GitStatusSnapshot,
  HostResponse,
} from '@piwin/contracts';
import { Button, Field, Notice } from '@piwin/ui-kit';
import { useConfirmDialog } from './use-confirm-dialog';

type GitRequest =
  | { type: 'git/status'; projectPath: string }
  | { type: 'git/diff-summary'; projectPath: string }
  | { type: 'git/log-graph'; projectPath: string; limit?: number }
  | { type: 'git/stage'; input: { projectPath: string; paths: string[] } }
  | { type: 'git/unstage'; input: { projectPath: string; paths: string[] } }
  | {
      type: 'git/commit';
      input: { projectPath: string; message: string; allTracked?: boolean };
    }
  | {
      type: 'git/branch-create';
      input: { projectPath: string; name: string; checkout?: boolean };
    }
  | { type: 'git/checkout'; input: { projectPath: string; ref: string } };

export type GitPanelProps = {
  projectPath: string | null;
  request: (command: GitRequest) => Promise<HostResponse>;
  onClose?: () => void;
  variant?: 'drawer' | 'embedded';
};

/**
 * Git panel: read models + policy-gated writes.
 * Distinct from agent session tree. No force-push / hard reset.
 */
export function GitPanel(props: GitPanelProps) {
  const confirmDialog = useConfirmDialog();
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [diff, setDiff] = useState<GitDiffSummary | null>(null);
  const [graph, setGraph] = useState<GitCommitGraph | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [branchName, setBranchName] = useState('');
  const [checkoutRef, setCheckoutRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!props.projectPath) {
      setError('Open a project first');
      return;
    }
    setLoading(true);
    setError(null);
    const path = props.projectPath;
    const [statusResponse, diffResponse, graphResponse] = await Promise.all([
      props.request({ type: 'git/status', projectPath: path }),
      props.request({ type: 'git/diff-summary', projectPath: path }),
      props.request({ type: 'git/log-graph', projectPath: path, limit: 30 }),
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
    if (!graphResponse.success) {
      setError(graphResponse.error);
      return;
    }
    const nextStatus = (statusResponse.data as { snapshot: GitStatusSnapshot }).snapshot;
    const nextDiff = (diffResponse.data as { summary: GitDiffSummary }).summary;
    const nextGraph = (graphResponse.data as { graph: GitCommitGraph }).graph;
    setStatus(nextStatus);
    setDiff(nextDiff);
    setGraph(nextGraph);
    setSelectedHash(nextGraph.nodes[0]?.hash ?? null);
    setSelectedPaths((current) =>
      current.filter((pathValue) =>
        nextStatus.changedFiles.some((file) => file.path === pathValue),
      ),
    );
  }, [props]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function togglePath(pathValue: string): void {
    setSelectedPaths((current) =>
      current.includes(pathValue)
        ? current.filter((item) => item !== pathValue)
        : [...current, pathValue],
    );
  }

  async function runMutation(
    command: GitRequest,
    confirmText: string,
  ): Promise<void> {
    const ok = await confirmDialog.confirm({
      title: 'Confirm git action',
      description: confirmText,
      confirmLabel: 'Continue',
      tone: 'default',
    });
    if (!ok) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const response = await props.request(command);
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const result = (response.data as { result?: GitMutationResult } | undefined)?.result;
    setInfo(result?.message ?? 'ok');
    await reload();
  }

  const selected: GitCommitGraphNode | null =
    graph?.nodes.find((node) => node.hash === selectedHash) ?? null;
  const projectPath = props.projectPath;

  const embedded = props.variant === 'embedded';

  return (
    <>
    {confirmDialog.dialog}
    <div className={embedded ? 'embedded-panel git-panel' : 'modal-backdrop'}>
      <div className={embedded ? 'embedded-body git-panel-body' : 'modal settings-modal git-panel'}>
        {embedded ? null : <h3>Git</h3>}
        {embedded ? null : (
        <p className="muted">
          Status / diff / graph are read-only models. Writes (stage/commit/branch) require explicit
          confirm. No force-push or hard reset.
        </p>
        )}
        {loading ? <p className="muted">Loading git…</p> : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {info ? <Notice tone="info">{info}</Notice> : null}

        {!status?.repository.isRepository ? (
          <p className="muted">Not a git repository (or git unavailable).</p>
        ) : (
          <>
            <section className="git-section">
              <h4>Branch</h4>
              <ul className="muted list">
                <li>
                  root: <code>{status.repository.rootPath}</code>
                </li>
                <li>
                  branch:{' '}
                  {status.branch?.isDetached
                    ? `detached @ ${status.branch.headCommit?.slice(0, 7) ?? '?'}`
                    : status.branch?.currentBranch ?? '(unknown)'}
                </li>
                <li>
                  tracking:{' '}
                  {status.branch?.upstreamBranch
                    ? `${status.branch.upstreamBranch} (↑${status.branch.ahead} ↓${status.branch.behind})`
                    : 'none'}
                </li>
                <li>dirty: {status.branch?.dirty ? 'yes' : 'no'}</li>
              </ul>
            </section>

            <section className="git-section">
              <h4>Changed files</h4>
              {status.changedFiles.length === 0 ? (
                <p className="muted">Working tree clean</p>
              ) : (
                <ul className="ext-list compact">
                  {status.changedFiles.map((file) => (
                    <li key={`${file.status}:${file.path}`} className="ext-list-item">
                      <label className="ext-list-main git-file-row">
                        <input
                          type="checkbox"
                          checked={selectedPaths.includes(file.path)}
                          onChange={() => togglePath(file.path)}
                        />
                        <span className="pill">{file.status}</span>
                        {file.staged ? <span className="pill">staged</span> : null}
                        {file.unstaged ? <span className="pill">unstaged</span> : null}
                        <code className="git-path">{file.path}</code>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <div className="row-actions" style={{ marginTop: 8 }}>
                <Button
                  disabled={busy || !projectPath}
                  onClick={() =>
                    void runMutation(
                      {
                        type: 'git/stage',
                        input: { projectPath: projectPath!, paths: selectedPaths },
                      },
                      selectedPaths.length === 0
                        ? 'Stage ALL changes in this repository?'
                        : `Stage ${selectedPaths.length} selected path(s)?`,
                    )
                  }
                >
                  Stage {selectedPaths.length > 0 ? 'selected' : 'all'}
                </Button>
                <Button
                  disabled={busy || !projectPath}
                  onClick={() =>
                    void runMutation(
                      {
                        type: 'git/unstage',
                        input: { projectPath: projectPath!, paths: selectedPaths },
                      },
                      selectedPaths.length === 0
                        ? 'Unstage ALL staged changes?'
                        : `Unstage ${selectedPaths.length} selected path(s)?`,
                    )
                  }
                >
                  Unstage {selectedPaths.length > 0 ? 'selected' : 'all'}
                </Button>
              </div>
            </section>

            <section className="git-section">
              <h4>Commit</h4>
              <Field label="Commit message" required>
                <textarea
                  rows={3}
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Summarize the staged changes"
                  data-testid="git-commit-message"
                />
              </Field>
              <Button
                variant="primary"
                disabled={busy || !projectPath || !commitMessage.trim()}
                onClick={() =>
                  void runMutation(
                    {
                      type: 'git/commit',
                      input: { projectPath: projectPath!, message: commitMessage },
                    },
                    `Create commit with message:\n\n${commitMessage.trim()}`,
                  ).then(() => setCommitMessage(''))
                }
              >
                Commit staged
              </Button>
            </section>

            <section className="git-section">
              <h4>Branch / checkout</h4>
              <Field label="New branch name">
                <input
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                  placeholder="feature/my-change"
                  data-testid="git-branch-name"
                />
              </Field>
              <div className="row-actions">
                <Button
                  disabled={busy || !projectPath || !branchName.trim()}
                  onClick={() =>
                    void runMutation(
                      {
                        type: 'git/branch-create',
                        input: {
                          projectPath: projectPath!,
                          name: branchName.trim(),
                          checkout: true,
                        },
                      },
                      `Create and checkout branch "${branchName.trim()}"?`,
                    ).then(() => setBranchName(''))
                  }
                >
                  Create+checkout
                </Button>
              </div>
              <Field label="Checkout ref" description="Branch name or commit ref">
                <input
                  value={checkoutRef}
                  onChange={(event) => setCheckoutRef(event.target.value)}
                  placeholder="main"
                  data-testid="git-checkout-ref"
                />
              </Field>
              <div className="row-actions">
                <Button
                  disabled={busy || !projectPath || !checkoutRef.trim()}
                  onClick={() =>
                    void runMutation(
                      {
                        type: 'git/checkout',
                        input: { projectPath: projectPath!, ref: checkoutRef.trim() },
                      },
                      `Checkout "${checkoutRef.trim()}"? Uncommitted changes may block this.`,
                    )
                  }
                >
                  Checkout
                </Button>
              </div>
            </section>

            <section className="git-section">
              <h4>
                Diff summary
                {diff
                  ? ` (+${diff.totalAdditions} / -${diff.totalDeletions}${diff.truncated ? ', truncated' : ''})`
                  : ''}
              </h4>
              {!diff || diff.files.length === 0 ? (
                <p className="muted">No numstat changes vs HEAD</p>
              ) : (
                <ul className="ext-list compact">
                  {diff.files.map((file) => (
                    <li key={file.path} className="ext-list-item">
                      <div className="ext-list-main">
                        <code className="git-path">{file.path}</code>
                        <span className="muted">
                          +{file.additions} / -{file.deletions}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="git-section git-graph-section">
              <h4>Commit graph (not session tree)</h4>
              <div className="git-graph-layout">
                <ul className="ext-list compact git-graph-list">
                  {(graph?.nodes ?? []).map((node) => (
                    <li key={node.hash}>
                      <button
                        type="button"
                        className={
                          selectedHash === node.hash ? 'session-item active' : 'session-item'
                        }
                        onClick={() => setSelectedHash(node.hash)}
                      >
                        <code>{node.shortHash}</code> {node.subject}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="git-commit-detail">
                  {selected ? (
                    <>
                      <div>
                        <strong>{selected.subject}</strong>
                      </div>
                      <div className="muted">
                        {selected.shortHash} · {selected.authorName}
                      </div>
                      <div className="muted">{selected.authorDateIso}</div>
                      <div className="muted">
                        parents:{' '}
                        {selected.parentHashes.length === 0
                          ? '(root)'
                          : selected.parentHashes.map((hash) => hash.slice(0, 7)).join(', ')}
                      </div>
                    </>
                  ) : (
                    <p className="muted">Select a commit</p>
                  )}
                </div>
              </div>
            </section>
          </>
        )}

        <div className={embedded ? 'drawer-actions' : 'modal-actions'}>
          <Button onClick={() => void reload()} disabled={loading}>
            Refresh
          </Button>
          {embedded ? null : (
            <Button variant="primary" onClick={() => props.onClose?.()}>
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
