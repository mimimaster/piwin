import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { HostResponse, SessionSummary, SubagentBatchProjection } from '@piwin/contracts';
import { formatError } from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';

type SubAgentRequest = {
  type: 'session/list-children';
  parentSessionId: string;
} | {
  type: 'subagent/batch-cancel';
  runId: string;
};

export type SubAgentPanelProps = {
  parentSessionId: string | null;
  request: (command: SubAgentRequest) => Promise<HostResponse>;
  onOpenSession: (sessionId: string) => void;
  onClose?: () => void;
  variant?: 'drawer' | 'embedded';
  /** Live child list from host pushes; when provided, it supersedes local reload. */
  children?: SessionSummary[];
  /** Active batch projections for the selected parent session. */
  batches?: Record<string, SubagentBatchProjection>;
};

export function SubAgentPanel(props: SubAgentPanelProps): ReactElement | null {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [children, setChildren] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!props.parentSessionId) {
      setChildren([]);
      return;
    }
    setError(null);
    const response = await props.request({
      type: 'session/list-children',
      parentSessionId: props.parentSessionId,
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setChildren((response.data as { sessions: SessionSummary[] }).sessions ?? []);
  }, [props.parentSessionId, props.request]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const effectiveChildren = props.children ?? children;
  const runningBatches = Object.entries(props.batches ?? {}).filter(
    ([, batch]) => batch.status === 'running',
  );
  const hasRunningBatches = runningBatches.length > 0;
  const hasChildren = effectiveChildren.length > 0;

  if (!error && !hasRunningBatches && !hasChildren) {
    return null;
  }

  return (
    <div
      className={
        props.variant === 'embedded'
          ? 'settings-section settings-section-card'
          : 'settings-inline-content'
      }
      style={props.variant === 'embedded' ? { marginTop: 24 } : undefined}
      data-testid={
        props.variant === 'embedded' ? 'settings-automation-subagents' : 'subagent-panel'
      }
    >
      <PageTitle title={isChinese ? 'Agent 子会话' : 'Agent sub-sessions'} />

      {error ? <Notice tone="error">{error}</Notice> : null}

      {hasRunningBatches ? (
        <div className="settings-section" data-testid="subagent-active-batches">
          <PageTitle title={isChinese ? '运行中的批次' : 'Active batches'} />
          <ul className="ext-list">
            {runningBatches.map(([runId, batch]) => (
              <li key={runId} className="ext-list-item">
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{isChinese ? '子代理批次' : 'Subagent batch'}</strong>
                    <span className="pill">{batch.status}</span>
                  </div>
                  <div className="muted ext-desc">{runId}</div>
                </div>
                <Button
                  size="compact"
                  variant="danger"
                  disabled={cancellingRunId === runId}
                  data-testid={`subagent-batch-cancel-${runId}`}
                  onClick={() => {
                    setCancellingRunId(runId);
                    void props
                      .request({ type: 'subagent/batch-cancel', runId })
                      .then((response) => {
                        setCancellingRunId(null);
                        if (!response.success) setError(response.error);
                      })
                      .catch((requestError: unknown) => {
                        setCancellingRunId(null);
                        setError(formatError(requestError));
                      });
                  }}
                >
                  {cancellingRunId === runId
                    ? (isChinese ? '取消中…' : 'Cancelling…')
                    : (isChinese ? '取消' : 'Cancel')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasChildren ? (
        <div className="settings-section">
          <PageTitle title={isChinese ? '历史子会话' : 'Child sessions'} />
          <ul className="ext-list">
            {effectiveChildren.map((child) => (
              <li key={child.id} className="ext-list-item">
                <div className="ext-list-main">
                  <div className="ext-list-title">
                    <strong>{child.name || child.id}</strong>
                    <span className="pill">{child.subagentStatus || 'unknown'}</span>
                  </div>
                  <div className="muted ext-desc">{child.lastPreview || child.task}</div>
                </div>
                <Button size="compact" variant="ghost" onClick={() => props.onOpenSession(child.id)}>
                  {isChinese ? '打开' : 'Open'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
