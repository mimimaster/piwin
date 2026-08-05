/**
 * Settings → Session Runtime page (spec §12.5).
 * Shows the active session's runtime state and reports stale settings
 * honestly. Runtime replacement remains unavailable until its full
 * transaction and Run tree are complete, so users are directed to start a
 * new session.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { SessionRuntimeStatus } from '@piwin/contracts';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

export function SessionRuntimePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { request, activeSessionId } = useSettings();
  const [runtimeStatus, setRuntimeStatus] = useState<SessionRuntimeStatus | null>(null);

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
            <p className="muted" data-testid="runtime-reload-unavailable-note">
              {isZh
                ? '当前运行时重载暂不可用。请新建会话以应用这些设置。'
                : 'Runtime reload is currently unavailable. Start a new session to apply these settings.'}
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
