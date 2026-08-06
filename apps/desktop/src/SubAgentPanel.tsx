import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, SessionSummary, SubagentBatchProjection } from '@piwin/contracts'
import { formatError } from '@piwin/contracts';;
import { Button, Notice, Spinner } from '@piwin/ui-kit';
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

export function SubAgentPanel(props: SubAgentPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [children, setChildren] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancellingRunId, setCancellingRunId] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!props.parentSessionId) {
      setChildren([]);
      return;
    }
    setBusy(true);
    setError(null);
    const response = await props.request({
      type: 'session/list-children',
      parentSessionId: props.parentSessionId,
    });
    setBusy(false);
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

  return (
    <div className="settings-inline-content">
      <PageTitle
        title={isChinese ? 'Agent 子会话' : 'Agent sub-sessions'}
        description={
          isChinese
            ? '查看历史子会话，并通过统一批次调度入口取消正在运行的批次。'
            : 'View historical child sessions and cancel active batches through the unified host authority.'
        }
      />

      <p className="muted" data-testid="subagent-actions-unavailable-note">
        {isChinese
          ? '可查看子会话，并取消当前仍在运行的统一批次。'
          : 'View child sessions and cancel active batches through the unified host authority.'}
      </p>

      {error ? <Notice tone="error">{error}</Notice> : null}

      {Object.entries(props.batches ?? {}).some(([, batch]) =>
        batch.status === 'running',
      ) ? (
        <div className="settings-section" data-testid="subagent-active-batches">
          <PageTitle title={isChinese ? '运行中的批次' : 'Active batches'} />
          <ul className="ext-list">
            {Object.entries(props.batches ?? {})
              .filter(([, batch]) => batch.status === 'running')
              .map(([runId, batch]) => (
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
                      void props.request({ type: 'subagent/batch-cancel', runId }).then((response) => {
                        setCancellingRunId(null);
                        if (!response.success) setError(response.error);
                      }).catch((requestError: unknown) => {
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

      <div className="settings-section">
        <PageTitle title={isChinese ? '历史子会话' : 'Child sessions'} />
        {effectiveChildren.length === 0 && !busy ? (
          <p className="muted" style={{ textAlign: 'center', padding: '32px' }}>
            {isChinese ? '尚无子会话' : 'No child sessions yet'}
          </p>
        ) : (
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
        )}
        {busy ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spinner />
          </div>
        ) : null}
      </div>
    </div>
  );
}
