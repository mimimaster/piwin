import { useCallback, useEffect, useState } from 'react';
import type { HostResponse, SessionSummary, SubagentProfile } from '@piwin/contracts';
import { Button, Notice, Spinner, IconButton } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';

type SubAgentRequest =
  | {
      type: 'session/spawn';
      parentSessionId: string;
      task: string;
      sessionName?: string;
      mode?: 'readonly' | 'worktree';
      applyPolicy?: 'none' | 'auto' | 'explicit';
      retainWorktree?: boolean;
      /** CE-SUB-PROF: profile id resolved from Settings. */
      profileId?: string;
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
  /** Live child list from host pushes; when provided, supersedes local reload. */
  children?: SessionSummary[];
  /** CE-SUB-PROF: resolved profiles available for selection in the spawn form. */
  profiles?: SubagentProfile[];
};

export function SubAgentPanel(props: SubAgentPanelProps) {
  const { locale, translator } = useDesktopLocale();
  const common = translator.common;
  const isChinese = locale === 'zh-CN';
  const copy = isChinese
    ? {
        subAgents: 'Agent',
        description: '创建拥有独立记录的 Agent 子会话。',
        spawn: '创建',
        refresh: '刷新',
        noSubAgents: '尚无子代理',
        task: '任务',
        mode: '模式',
        applyPolicy: '应用策略',
        spawnNew: '创建 Agent',
        spawnDesc: '启动一个专用于特定任务的子会话。',
      }
    : {
        subAgents: 'Sub-agents',
        description: 'Spawns a child session with its own transcript.',
        spawn: 'Spawn',
        refresh: 'Refresh',
        noSubAgents: 'No sub-agents yet',
        task: 'Task',
        mode: 'Mode',
        applyPolicy: 'Apply policy',
        spawnNew: 'Spawn New Sub-agent',
        spawnDesc: 'Start a child session for a specific task.',
      };

  const [task, setTask] = useState('');
  const [mode, setMode] = useState<'readonly' | 'worktree'>('readonly');
  const [applyPolicy, setApplyPolicy] = useState<'none' | 'auto' | 'explicit'>('none');
  const [profileId, setProfileId] = useState<string>('');
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
  }, [props.parentSessionId, reload]);

  async function handleSpawn(): Promise<void> {
    if (!props.parentSessionId || !task.trim()) return;
    setBusy(true);
    setError(null);
    const response = await props.request({
      type: 'session/spawn',
      parentSessionId: props.parentSessionId,
      task: task.trim(),
      mode,
      applyPolicy,
      retainWorktree: false,
      ...(profileId ? { profileId } : {}),
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setTask('');
    setProfileId('');
    await reload();
  }

  async function handleCancel(sessionId: string): Promise<void> {
    setBusy(true);
    const response = await props.request({ type: 'session/cancel-subagent', sessionId });
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

  return (
    <div className="settings-inline-content">
      <PageTitle title={copy.subAgents} description={copy.description} />

      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="settings-section">
        <PageTitle title={isChinese ? '活跃子代理' : 'Active Sub-agents'} />
        <ul className="ext-list">
          {(() => {
            const effectiveChildren = props.children ?? children;
            return effectiveChildren.length === 0 && !busy ? (
              <li className="muted" style={{ textAlign: 'center', padding: '32px' }}>
                {copy.noSubAgents}
              </li>
            ) : (
              effectiveChildren.map((child) => (
                <li key={child.id} className="ext-list-item">
                  <div className="ext-list-main">
                    <div className="ext-list-title">
                      <strong>{child.name || child.id}</strong>
                      <span className="pill">{child.subagentStatus || 'unknown'}</span>
                    </div>
                    <div className="muted ext-desc">{child.lastPreview || child.task}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => props.onOpenSession(child.id)}
                    >
                      {isChinese ? '打开' : 'Open'}
                    </Button>
                    {!child.mergedAt && (
                      <Button size="compact" onClick={() => void handleMerge(child.id)}>
                        {isChinese ? '合并' : 'Merge'}
                      </Button>
                    )}
                    <IconButton label={common.delete} onClick={() => void handleCancel(child.id)}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M3 4h10M6 4V2.75h4V4M5 6.25v5.5M8 6.25v5.5M11 6.25v5.5M4 4l.5 9h7l.5-9" />
                      </svg>
                    </IconButton>
                  </div>
                </li>
              ))
            );
          })()}
        </ul>
        {busy && (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spinner />
          </div>
        )}
      </div>

      <div className="settings-section">
        <PageTitle title={copy.spawnNew} description={copy.spawnDesc} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600 }}>{copy.task}</label>
            <textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder={
                isChinese ? '描述子代理需要完成的任务...' : 'What should the sub-agent do?'
              }
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--line-soft)',
                background: 'var(--surface-raised)',
                color: 'var(--text)',
                resize: 'vertical',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600 }}>
                {isChinese ? '配置' : 'Profile'}
              </label>
              <select
                value={profileId}
                onChange={(e) => setProfileId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid var(--line-soft)',
                  background: 'var(--surface-raised)',
                  color: 'var(--text)',
                }}
              >
                <option value="">{isChinese ? '无（手动模式）' : 'None (manual mode)'}</option>
                {(props.profiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.id} — {profile.description}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600 }}>{copy.mode}</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid var(--line-soft)',
                  background: 'var(--surface-raised)',
                  color: 'var(--text)',
                }}
              >
                <option value="readonly">{isChinese ? '只读' : 'Readonly'}</option>
                <option value="worktree">{isChinese ? '工作树' : 'Worktree'}</option>
              </select>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '13px', fontWeight: 600 }}>{copy.applyPolicy}</label>
              <select
                value={applyPolicy}
                onChange={(e) => setApplyPolicy(e.target.value as any)}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '8px',
                  border: '1px solid var(--line-soft)',
                  background: 'var(--surface-raised)',
                  color: 'var(--text)',
                }}
              >
                <option value="none">{isChinese ? '不应用' : 'None'}</option>
                <option value="auto">{isChinese ? '自动' : 'Auto'}</option>
                <option value="explicit">{isChinese ? '显式' : 'Explicit'}</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="primary"
              disabled={busy || !task.trim() || !props.parentSessionId}
              onClick={() => void handleSpawn()}
            >
              {copy.spawn}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
