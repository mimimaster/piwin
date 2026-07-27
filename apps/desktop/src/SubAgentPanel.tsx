import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, SessionSummary } from '@piwin/contracts';
import { Button, Field, Notice, EmptyState } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

type SubAgentRequest =
  | {
      type: 'session/spawn';
      parentSessionId: string;
      task: string;
      sessionName?: string;
      mode?: 'readonly' | 'worktree';
      applyPolicy?: 'none' | 'auto' | 'explicit';
      retainWorktree?: boolean;
    }
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
  const { locale } = useDesktopLocale();
  const copy = locale === 'zh-CN'
    ? {
        subAgents: '子代理',
        close: '关闭',
        description:
          '创建拥有独立记录的子会话（深度 1）。使用“完成并合并”可将提取式摘要追加到父聊天（幂等）。',
        parentSessionRequired: '需要父会话和任务',
        mergeFailed: (hostError: string) =>
          `合并失败：${hostError}。请确认子会话已经完成（未运行）后重试。若应用策略阻止合并，只能通过 Host 强制合并。`,
        selectMainSession: '选择主会话',
        selectMainSessionDescription: '子代理会附加到当前活动的父聊天（深度 1）。',
        task: '任务',
        taskPlaceholder: '子代理应完成什么任务？',
        mode: '模式',
        readonly: '只读',
        worktree: '工作树',
        applyPolicy: '应用策略',
        none: '不应用',
        auto: '自动',
        explicit: '显式',
        spawn: '创建',
        refresh: '刷新',
        merged: '已合并',
        unknown: '未知',
        isolationMode: '隔离模式',
        open: '打开',
        completeAndMerge: '完成并合并',
        complete: '完成',
        cancel: '取消',
        mergeIntoParent: '合并到父会话',
        noSubAgents: '尚无子代理',
        noSubAgentsDescription: '创建一个具有明确任务的只读或工作树子会话。',
      }
    : {
        subAgents: 'Sub-agents',
        close: 'Close',
        description:
          'Spawns a child session (depth 1) with its own transcript. Use Complete & merge to append an extractive summary into the parent chat (idempotent).',
        parentSessionRequired: 'Parent session and task required',
        mergeFailed: (hostError: string) =>
          `Merge failed: ${hostError}. Ensure the child is completed (not running), then retry. Force merge is available only via host if apply policy blocks.`,
        selectMainSession: 'Select a main session',
        selectMainSessionDescription: 'Sub-agents attach to the active parent chat (depth 1).',
        task: 'Task',
        taskPlaceholder: 'What should the sub-agent do?',
        mode: 'Mode',
        readonly: 'readonly',
        worktree: 'worktree',
        applyPolicy: 'Apply policy',
        none: 'none',
        auto: 'auto',
        explicit: 'explicit',
        spawn: 'Spawn',
        refresh: 'Refresh',
        merged: 'merged',
        unknown: 'unknown',
        isolationMode: 'Isolation mode',
        open: 'Open',
        completeAndMerge: 'Complete & merge',
        complete: 'Complete',
        cancel: 'Cancel',
        mergeIntoParent: 'Merge into parent',
        noSubAgents: 'No sub-agents yet',
        noSubAgentsDescription: 'Spawn a readonly or worktree child with a clear task.',
      };
  const [task, setTask] = useState('');
  const [mode, setMode] = useState<'readonly' | 'worktree'>('readonly');
  const [applyPolicy, setApplyPolicy] = useState<'none' | 'auto' | 'explicit'>('none');
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
      setError(copy.parentSessionRequired);
      return;
    }
    setBusy(true);
    setError(null);
    const response = await props.request({
      type: 'session/spawn',
      parentSessionId: props.parentSessionId,
      task: task.trim(),
      mode,
      applyPolicy,
      retainWorktree: false,
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
      setError(copy.mergeFailed(merged.error));
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
      aria-label={copy.subAgents}
    >
      {embedded ? null : (
        <header className="drawer-header">
          <strong>{copy.subAgents}</strong>
          <Button onClick={() => props.onClose?.()}>
            {copy.close}
          </Button>
        </header>
      )}
      <div className={embedded ? 'embedded-body' : 'drawer-body'}>
        {embedded ? null : (
          <p className="muted">
            {copy.description}
          </p>
        )}
        {!props.parentSessionId ? (
          <EmptyState
            title={copy.selectMainSession}
            description={copy.selectMainSessionDescription}
            testId="subagent-no-parent"
          />
        ) : (
          <>
            <Field label={copy.task} required>
              <textarea
                rows={3}
                data-testid="subagent-task-input"
                value={task}
                onChange={(event) => setTask(event.target.value)}
                placeholder={copy.taskPlaceholder}
              />
            </Field>
            <div className="subagent-options">
              <Field label={copy.mode}>
                <select
                  data-testid="subagent-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as 'readonly' | 'worktree')}
                >
                  <option value="readonly">{copy.readonly}</option>
                  <option value="worktree">{copy.worktree}</option>
                </select>
              </Field>
              <Field label={copy.applyPolicy}>
                <select
                  data-testid="subagent-apply-policy"
                  value={applyPolicy}
                  onChange={(event) =>
                    setApplyPolicy(event.target.value as 'none' | 'auto' | 'explicit')
                  }
                >
                  <option value="none">{copy.none}</option>
                  <option value="auto">{copy.auto}</option>
                  <option value="explicit">{copy.explicit}</option>
                </select>
              </Field>
            </div>
            <div className="drawer-actions">
              <Button
                variant="primary"
                data-testid="subagent-spawn-btn"
                disabled={busy || !task.trim()}
                onClick={() => void handleSpawn()}
              >
                {copy.spawn}
              </Button>
              <Button disabled={busy} onClick={() => void reload()}>
                {copy.refresh}
              </Button>
            </div>
          </>
        )}
        {error ? <Notice tone="error">{error}</Notice> : null}
        <ul className="subagent-list">
          {children.map((child) => {
            const status = child.subagentStatus ?? copy.unknown;
            const isRunning = status === 'running';
            const canMerge =
              (status === 'done' || status === 'failed' || status === 'cancelled') &&
              !child.mergedAt;
            return (
              <li key={child.id} className="subagent-card">
                <div>
                  <strong>{child.name ?? child.id.slice(0, 8)}</strong>
                  <span className="muted"> · {status}</span>
                  {child.mergedAt ? <span className="muted"> · {copy.merged}</span> : null}
                </div>
                <div className="subagent-isolation-row" data-testid="subagent-isolation">
                  <span
                    className="pill"
                    data-testid="subagent-mode-chip"
                    title={copy.isolationMode}
                  >
                    {child.subagentMode ?? copy.unknown}
                  </span>
                  {child.worktreePath ? (
                    <span
                      className="muted subagent-worktree-path"
                      data-testid="subagent-worktree-path"
                      title={child.worktreePath}
                    >
                      {child.worktreePath}
                    </span>
                  ) : null}
                </div>
                {child.task ? <div className="muted">{child.task}</div> : null}
                {child.summaryPreview ? (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {child.summaryPreview}
                  </div>
                ) : null}
                <div className="drawer-actions">
                  <Button onClick={() => props.onOpenSession(child.id)}>
                    {copy.open}
                  </Button>
                  {isRunning ? (
                    <>
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() => void handleCompleteAndMerge(child.id)}
                      >
                        {copy.completeAndMerge}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void handleComplete(child.id)}
                      >
                        {copy.complete}
                      </Button>
                      <Button
                        disabled={busy}
                        onClick={() => void handleCancel(child.id)}
                      >
                        {copy.cancel}
                      </Button>
                    </>
                  ) : null}
                  {canMerge ? (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => void handleMerge(child.id)}
                    >
                      {copy.mergeIntoParent}
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {children.length === 0 && props.parentSessionId ? (
          <EmptyState
            title={copy.noSubAgents}
            description={copy.noSubAgentsDescription}
            testId="subagent-empty"
          />
        ) : null}
      </div>
    </div>
  );
}
