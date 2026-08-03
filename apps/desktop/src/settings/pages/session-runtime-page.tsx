/**
 * Settings → Session Runtime page (spec §12.5).
 * Shows the active session's runtime state (lazy-shell/live/stale) and the
 * Pending Changes bar: "Settings are saved, but the current Agent still uses
 * the previous runtime schema." Actions:
 *   1. Start new session (safest — recommended)
 *   2. Apply after current run (queues runtime replacement)
 *   3. Advanced: reload current Agent (explicit context-reconstruction warning)
 *   4. Stop and apply now (only while running, requires confirmation)
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SessionRuntimeStatus } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

export function SessionRuntimePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { request, config, activeSessionId, setInfo, setError } = useSettings();
  const [runtimeStatus, setRuntimeStatus] = useState<SessionRuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (!activeSessionId) {
      setRuntimeStatus(null);
      return;
    }
    const response = await request({
      type: 'session/runtime-status',
      sessionId: activeSessionId,
    });
    if (!response.success) {
      setRuntimeStatus(null);
      return;
    }
    const data = response.data as { status?: SessionRuntimeStatus };
    setRuntimeStatus(data.status ?? null);
  }, [activeSessionId, request]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function handleReload(when: 'now' | 'after-current-run'): Promise<void> {
    if (!activeSessionId || !config) return;
    setBusy(true);
    setError(null);
    const response = await request({
      type: 'session/reload-runtime',
      sessionId: activeSessionId,
      expectedSettingsRevision: '', // Host runtime controller records revision at attach
      when,
    });
    setBusy(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(
      isZh
        ? when === 'now'
          ? '已重载当前 Agent 运行时。'
          : '将在当前回合结束后应用新的运行时。'
        : when === 'now'
          ? 'Reloaded the current Agent runtime.'
          : 'New runtime will apply after the current run.',
    );
    await refresh();
  }

  const stale = runtimeStatus?.state === 'stale';
  const stateLabel =
    runtimeStatus === null
      ? isZh
        ? '无活动会话'
        : 'No active session'
      : runtimeStatus.state === 'stale'
        ? isZh
          ? '待更新（Stale）'
          : 'Stale'
        : runtimeStatus.state === 'live'
          ? isZh
            ? '运行中（Live）'
            : 'Live'
          : isZh
            ? '惰性外壳（Lazy shell）'
            : 'Lazy shell';

  return (
    <div className="settings-card">
      <div className="settings-section settings-section-card" data-testid="session-runtime-section">
        <PageTitle
          title={isZh ? '会话运行时' : 'Session Runtime'}
          description={
            isZh
              ? '查看当前 Agent 运行时使用的是哪个设置快照，以及设置变更后何时生效。'
              : 'See which Settings snapshot the current Agent runtime was created from and when changes take effect.'
          }
        />
        <div className="ui-field-row" data-testid="runtime-state-row">
          <span className="muted">{isZh ? '当前状态' : 'Current state'}:</span>
          <strong data-testid="runtime-state-value">{stateLabel}</strong>
        </div>

        {runtimeStatus?.generationId ? (
          <div className="ui-field-row">
            <span className="muted">{isZh ? '运行时代次' : 'Generation'}:</span>
            <code>{runtimeStatus.generationId}</code>
          </div>
        ) : null}

        {stale ? (
          <div
            className="settings-notice settings-notice--warning"
            data-testid="pending-changes-bar"
          >
            <p>
              {isZh
                ? '设置已保存，但当前 Agent 仍在使用旧的运行时 schema。'
                : 'Settings are saved, but the current Agent still uses the previous runtime schema.'}
            </p>
            {runtimeStatus.staleDomains.length > 0 ? (
              <p className="muted">
                {isZh ? '受影响设置：' : 'Affected settings: '}
                {runtimeStatus.staleDomains.join(', ')}
              </p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <Button
                data-testid="runtime-reload-now-button"
                disabled={busy}
                onClick={() => void handleReload('now')}
              >
                {isZh ? '现在重载当前 Agent' : 'Reload current Agent now'}
              </Button>
              <Button
                variant="secondary"
                data-testid="runtime-apply-after-run-button"
                disabled={busy}
                onClick={() => void handleReload('after-current-run')}
              >
                {isZh ? '当前回合结束后应用' : 'Apply after current run'}
              </Button>
            </div>
            <p className="muted" style={{ marginTop: 8 }}>
              {isZh
                ? '重载会基于产品历史重建上下文（有损恢复）。更安全的做法是新建会话。'
                : 'Reload reconstructs context from product history (lossy). Starting a new session is safer.'}
            </p>
          </div>
        ) : (
          <p className="muted" data-testid="runtime-fresh-note">
            {isZh
              ? '当前 Agent 与最新设置一致，无需更新。'
              : 'The current Agent matches the latest settings. No update needed.'}
          </p>
        )}
      </div>
    </div>
  );
}
