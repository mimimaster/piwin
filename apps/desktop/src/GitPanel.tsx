import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type {
  GitCommitGraph,
  GitCommitGraphNode,
  GitMutationResult,
  GitStatusSnapshot,
  HostResponse,
} from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';
import { IconArrowFork, IconRefresh } from './shell-icons';
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
  locale?: 'zh-CN' | 'en';
};

function formatRelativeTime(iso: string, locale: string = 'zh-CN'): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay > 30) {
      return new Date(iso).toLocaleDateString(locale === 'zh-CN' ? 'zh-CN' : 'en-US', {
        month: 'short',
        day: 'numeric',
      });
    }
    if (diffDay > 0) return locale === 'zh-CN' ? `${diffDay} 天前` : `${diffDay}d ago`;
    if (diffHour > 0) return locale === 'zh-CN' ? `${diffHour} 小时前` : `${diffHour}h ago`;
    if (diffMin > 0) return locale === 'zh-CN' ? `${diffMin} 分钟前` : `${diffMin}m ago`;
    return locale === 'zh-CN' ? '刚刚' : 'just now';
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Git / History panel — VS Code / Cursor style timeline & branch management.
 */
export function GitPanel(props: GitPanelProps): ReactElement {
  const confirmDialog = useConfirmDialog();
  const locale = props.locale ?? 'zh-CN';
  const [status, setStatus] = useState<GitStatusSnapshot | null>(null);
  const [graph, setGraph] = useState<GitCommitGraph | null>(null);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [activeForm, setActiveForm] = useState<'none' | 'new-branch' | 'checkout'>('none');
  const [branchName, setBranchName] = useState('');
  const [checkoutRef, setCheckoutRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!props.projectPath) {
      setError(locale === 'zh-CN' ? '请先打开项目' : 'Open a project first');
      return;
    }
    setLoading(true);
    setError(null);
    const path = props.projectPath;
    const [statusResponse, graphResponse] = await Promise.all([
      props.request({ type: 'git/status', projectPath: path }),
      props.request({ type: 'git/log-graph', projectPath: path, limit: 30 }),
    ]);
    setLoading(false);
    if (!statusResponse.success) {
      setError(statusResponse.error);
      return;
    }
    if (!graphResponse.success) {
      setError(graphResponse.error);
      return;
    }
    const nextStatus = (statusResponse.data as { snapshot: GitStatusSnapshot }).snapshot;
    const nextGraph = (graphResponse.data as { graph: GitCommitGraph }).graph;
    setStatus(nextStatus);
    setGraph(nextGraph);
    setSelectedHash((prev) =>
      prev && nextGraph.nodes.some((n) => n.hash === prev) ? prev : (nextGraph.nodes[0]?.hash ?? null),
    );
  }, [props.projectPath, props.request, locale]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runMutation(command: GitRequest, confirmText: string): Promise<void> {
    const ok = await confirmDialog.confirm({
      title: locale === 'zh-CN' ? '确认 Git 操作' : 'Confirm git action',
      description: confirmText,
      confirmLabel: locale === 'zh-CN' ? '继续' : 'Continue',
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
    setActiveForm('none');
    setBranchName('');
    setCheckoutRef('');
    await reload();
  }

  const selected: GitCommitGraphNode | null =
    graph?.nodes.find((node) => node.hash === selectedHash) ?? graph?.nodes[0] ?? null;
  const projectPath = props.projectPath;
  const embedded = props.variant === 'embedded';

  const branchLabel = status?.branch
    ? status.branch.isDetached
      ? `detached @ ${status.branch.headCommit?.slice(0, 7) ?? '?'}`
      : (status.branch.currentBranch ?? 'unknown')
    : '…';

  const upstreamInfo = status?.branch?.upstreamBranch
    ? `${status.branch.upstreamBranch} (↑${status.branch.ahead} ↓${status.branch.behind})`
    : null;

  return (
    <>
      {confirmDialog.dialog}
      <div className={embedded ? 'git-panel-embedded' : 'modal-backdrop'}>
        <div className={embedded ? 'git-panel-embedded-body' : 'modal settings-modal git-panel'}>
          {embedded ? null : <h3>{locale === 'zh-CN' ? 'Git 历史与分支' : 'Git History & Branches'}</h3>}

          {error ? <Notice tone="error">{error}</Notice> : null}
          {info ? <Notice tone="info">{info}</Notice> : null}

          {!status?.repository.isRepository ? (
            <div className="right-panel-empty muted">
              {locale === 'zh-CN' ? '非 Git 仓库' : 'Not a git repository.'}
            </div>
          ) : loading && !graph ? (
            <div className="git-skeleton" aria-hidden>
              <div className="git-skeleton-bar" style={{ width: '60%' }} />
              <div className="git-skeleton-bar" style={{ width: '85%' }} />
              <div className="git-skeleton-bar" style={{ width: '70%' }} />
            </div>
          ) : (
            <>
              {/* Branch Header Strip */}
              <div className="git-branch-strip" title={status.repository.rootPath}>
                <div className="git-branch-main">
                  <span
                    className={status.branch?.dirty ? 'git-branch-dot dirty' : 'git-branch-dot'}
                    aria-hidden
                  />
                  <strong className="git-branch-name">{branchLabel}</strong>
                  {upstreamInfo ? <span className="git-branch-up">{upstreamInfo}</span> : null}
                </div>
                <div className="git-branch-actions">
                  <button
                    type="button"
                    className={`git-strip-btn${activeForm === 'new-branch' ? ' active' : ''}`}
                    onClick={() =>
                      setActiveForm((cur) => (cur === 'new-branch' ? 'none' : 'new-branch'))
                    }
                    title={locale === 'zh-CN' ? '新建分支' : 'New branch'}
                    aria-label={locale === 'zh-CN' ? '新建分支' : 'New branch'}
                  >
                    <IconArrowFork />
                  </button>
                  <button
                    type="button"
                    className={`git-strip-btn${activeForm === 'checkout' ? ' active' : ''}`}
                    onClick={() =>
                      setActiveForm((cur) => (cur === 'checkout' ? 'none' : 'checkout'))
                    }
                    title={locale === 'zh-CN' ? '切换分支或提交' : 'Checkout ref'}
                    aria-label={locale === 'zh-CN' ? '切换分支或提交' : 'Checkout ref'}
                  >
                    ⤹
                  </button>
                  <button
                    type="button"
                    className="git-strip-btn"
                    disabled={loading || busy}
                    onClick={() => void reload()}
                    title={locale === 'zh-CN' ? '刷新' : 'Refresh'}
                    aria-label={locale === 'zh-CN' ? '刷新' : 'Refresh'}
                  >
                    <IconRefresh />
                  </button>
                </div>
              </div>

              {/* Collapsible Action Forms */}
              {activeForm === 'new-branch' ? (
                <div className="git-inline-form">
                  <input
                    type="text"
                    className="git-inline-input"
                    value={branchName}
                    onChange={(e) => setBranchName(e.target.value)}
                    placeholder={locale === 'zh-CN' ? '新分支名称 (如 feature/x)' : 'New branch name'}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && branchName.trim() && projectPath) {
                        void runMutation(
                          {
                            type: 'git/branch-create',
                            input: {
                              projectPath,
                              name: branchName.trim(),
                              checkout: true,
                            },
                          },
                          `创建并切换到分支 "${branchName.trim()}"?`,
                        );
                      } else if (e.key === 'Escape') {
                        setActiveForm('none');
                      }
                    }}
                  />
                  <Button
                    size="compact"
                    variant="primary"
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
                        `创建并切换到分支 "${branchName.trim()}"?`,
                      )
                    }
                  >
                    {locale === 'zh-CN' ? '创建并切换' : 'Create'}
                  </Button>
                  <Button size="compact" onClick={() => setActiveForm('none')}>
                    {locale === 'zh-CN' ? '取消' : 'Cancel'}
                  </Button>
                </div>
              ) : null}

              {activeForm === 'checkout' ? (
                <div className="git-inline-form">
                  <input
                    type="text"
                    className="git-inline-input"
                    value={checkoutRef}
                    onChange={(e) => setCheckoutRef(e.target.value)}
                    placeholder={locale === 'zh-CN' ? '分支名或提交 Hash' : 'Branch or commit ref'}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && checkoutRef.trim() && projectPath) {
                        void runMutation(
                          {
                            type: 'git/checkout',
                            input: { projectPath, ref: checkoutRef.trim() },
                          },
                          `切换到 "${checkoutRef.trim()}"?`,
                        );
                      } else if (e.key === 'Escape') {
                        setActiveForm('none');
                      }
                    }}
                  />
                  <Button
                    size="compact"
                    variant="primary"
                    disabled={busy || !projectPath || !checkoutRef.trim()}
                    onClick={() =>
                      void runMutation(
                        {
                          type: 'git/checkout',
                          input: { projectPath: projectPath!, ref: checkoutRef.trim() },
                        },
                        `切换到 "${checkoutRef.trim()}"?`,
                      )
                    }
                  >
                    {locale === 'zh-CN' ? '切换' : 'Checkout'}
                  </Button>
                  <Button size="compact" onClick={() => setActiveForm('none')}>
                    {locale === 'zh-CN' ? '取消' : 'Cancel'}
                  </Button>
                </div>
              ) : null}

              {/* Commit Timeline Section */}
              <div className="git-timeline-section">
                <div className="git-section-title">
                  {locale === 'zh-CN' ? '最近提交' : 'Recent Commits'}
                </div>
                <div className="git-timeline-scroll">
                  <ul className="git-timeline" data-testid="git-timeline">
                    {(graph?.nodes ?? []).map((node) => {
                      const isHead = node.hash === status.branch?.headCommit;
                      const isSelected = (selectedHash ?? graph?.nodes[0]?.hash) === node.hash;
                      return (
                        <li
                          key={node.hash}
                          className={`git-tl-item${isHead ? ' head' : ''}${isSelected ? ' sel' : ''}`}
                        >
                          <button
                            type="button"
                            className="git-tl-btn"
                            onClick={() => setSelectedHash(node.hash)}
                          >
                            <span className="git-tl-node" aria-hidden />
                            <code className="git-tl-hash">{node.shortHash}</code>
                            <span className="git-tl-subject" title={node.subject}>
                              {node.subject}
                            </span>
                            {isHead ? <span className="git-tl-tag">HEAD</span> : null}
                            <span className="git-tl-when">
                              {formatRelativeTime(node.authorDateIso, locale)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>

                {/* Selected Commit Detail Inset Card */}
                {selected ? (
                  <div className="git-commit-card" data-testid="git-commit-card">
                    <div className="git-commit-subject">{selected.subject}</div>
                    <div className="git-commit-meta">
                      <code>{selected.shortHash}</code> · {selected.authorName} ·{' '}
                      {formatRelativeTime(selected.authorDateIso, locale)}
                    </div>
                    {selected.parentHashes.length > 0 ? (
                      <div className="git-commit-parents">
                        parents:{' '}
                        {selected.parentHashes.map((h) => (
                          <code key={h}>{h.slice(0, 7)}</code>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </>
          )}

          {embedded ? null : (
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <Button onClick={() => void reload()} disabled={loading}>
                {locale === 'zh-CN' ? '刷新' : 'Refresh'}
              </Button>
              <Button variant="primary" onClick={() => props.onClose?.()}>
                {locale === 'zh-CN' ? '关闭' : 'Close'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
