import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, SessionSummary } from '@piwin/contracts';

type SubAgentRequest =
  | { type: 'session/spawn'; parentSessionId: string; task: string; sessionName?: string }
  | { type: 'session/list-children'; parentSessionId: string }
  | { type: 'session/cancel-subagent'; sessionId: string }
  | { type: 'session/complete-subagent'; sessionId: string; status?: 'done' | 'failed' }
  | { type: 'session/merge-subagent'; childSessionId: string; force?: boolean };

export type SubAgentPanelProps = {
  parentSessionId: string | null;
  request: (command: SubAgentRequest) => Promise<HostResponse>;
  onOpenSession: (sessionId: string) => void;
  onClose?: () => void;
  /** Called after a successful merge so parent chat can reload messages. */
  onMergedIntoParent?: (parentSessionId: string) => void;
  variant?: 'drawer' | 'embedded';
};

/**
 * Product-layer sub-agents: child sessions with parent lineage (depth max 1).
 * Not Pi fork/session_tree — separate sessions + index metadata.
 */
export function SubAgentPanel(props: SubAgentPanelProps) {
  const [task, setTask] = useState('');
  const [children, setChildren] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
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
  }, [props]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.parentSessionId]);

  async function handleSpawn(): Promise<void> {
    if (!props.parentSessionId || !task.trim()) {
      setError('Parent session and task required');
      return;
    }
    setBusy(true);
    setError(null);
    const response = await props.request({
      type: 'session/spawn',
      parentSessionId: props.parentSessionId,
      task: task.trim(),
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setTask('');
    await reload();
  }

  async function handleCancel(sessionId: string): Promise<void> {
    setBusy(true);
    const response = await props.request({
      type: 'session/cancel-subagent',
      sessionId,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await reload();
  }

  async function handleComplete(sessionId: string): Promise<void> {
    setBusy(true);
    const response = await props.request({
      type: 'session/complete-subagent',
      sessionId,
      status: 'done',
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    await reload();
  }

  async function handleMerge(sessionId: string): Promise<void> {
    if (!props.parentSessionId) return;
    setBusy(true);
    const response = await props.request({
      type: 'session/merge-subagent',
      childSessionId: sessionId,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    props.onMergedIntoParent?.(props.parentSessionId);
    await reload();
  }

  async function handleCompleteAndMerge(sessionId: string): Promise<void> {
    if (!props.parentSessionId) return;
    setBusy(true);
    setError(null);
    const completed = await props.request({
      type: 'session/complete-subagent',
      sessionId,
      status: 'done',
    });
    if (!completed.success) {
      setBusy(false);
      setError(completed.error);
      return;
    }
    const merged = await props.request({
      type: 'session/merge-subagent',
      childSessionId: sessionId,
    });
    setBusy(false);
    if (!merged.success) {
      setError(merged.error);
      await reload();
      return;
    }
    props.onMergedIntoParent?.(props.parentSessionId);
    await reload();
  }

  const embedded = props.variant === 'embedded';

  return (
    <div
      className={embedded ? 'embedded-panel subagent-panel' : 'drawer-panel subagent-panel'}
      role={embedded ? 'region' : 'dialog'}
      aria-label="Sub-agents"
    >
      {embedded ? null : (
        <header className="drawer-header">
          <strong>Sub-agents</strong>
          <button type="button" className="btn" onClick={() => props.onClose?.()}>
            Close
          </button>
        </header>
      )}
      <div className={embedded ? 'embedded-body' : 'drawer-body'}>
        {embedded ? null : (
          <p className="muted">
            Spawns a child session (depth 1) with its own transcript. Use Complete &amp; merge to
            append an extractive summary into the parent chat (idempotent).
          </p>
        )}
        {!props.parentSessionId ? (
          <div className="muted">Select a main session first.</div>
        ) : (
          <>
            <label className="field">
              <span>Task</span>
              <textarea
                rows={3}
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder="What should the sub-agent do?"
              />
            </label>
            <div className="drawer-actions">
              <button
                type="button"
                className="btn primary"
                disabled={busy || !task.trim()}
                onClick={() => void handleSpawn()}
              >
                Spawn
              </button>
              <button type="button" className="btn" disabled={busy} onClick={() => void reload()}>
                Refresh
              </button>
            </div>
          </>
        )}
        {error ? <div className="error-banner">{error}</div> : null}
        <ul className="subagent-list">
          {children.map((child) => {
            const status = child.subagentStatus ?? 'unknown';
            const isRunning = status === 'running';
            const canMerge =
              (status === 'done' || status === 'failed' || status === 'cancelled') &&
              !child.mergedAt;
            return (
              <li key={child.id} className="subagent-card">
                <div>
                  <strong>{child.name ?? child.id.slice(0, 8)}</strong>
                  <span className="muted"> · {status}</span>
                  {child.mergedAt ? <span className="muted"> · merged</span> : null}
                </div>
                {child.task ? <div className="muted">{child.task}</div> : null}
                {child.summaryPreview ? (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {child.summaryPreview}
                  </div>
                ) : null}
                <div className="drawer-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => props.onOpenSession(child.id)}
                  >
                    Open
                  </button>
                  {isRunning ? (
                    <>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy}
                        onClick={() => void handleCompleteAndMerge(child.id)}
                      >
                        Complete &amp; merge
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void handleComplete(child.id)}
                      >
                        Complete
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => void handleCancel(child.id)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                  {canMerge ? (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy}
                      onClick={() => void handleMerge(child.id)}
                    >
                      Merge into parent
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {children.length === 0 && props.parentSessionId ? (
          <div className="muted">No child sub-agents yet.</div>
        ) : null}
      </div>
    </div>
  );
}
