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
import { useSettings } from '../settings-context';

export function SessionRuntimePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { request, hostClient, activeSessionId } = useSettings();
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
    if (!activeSessionId) {
      setRuntimeStatus(null);
      return;
    }

    const unsubscribe = hostClient?.subscribe((message) => {
      if (
        message.type === 'session/runtime-updated' &&
        message.status.sessionId === activeSessionId
      ) {
        setRuntimeStatus(message.status);
      }
    });
    void refresh();
    return () => unsubscribe?.();
  }, [activeSessionId, hostClient, refresh]);

  const stale = runtimeStatus?.state === 'stale';
  const rebuilding = runtimeStatus?.state === 'rebuilding';
  const failed = runtimeStatus?.state === 'failed';
  const stateLabel =
    runtimeStatus === null
      ? isZh
        ? '无活动会话'
        : 'No active session'
      : runtimeStatus.state === 'stale'
        ? isZh
          ? '待更新（Stale）'
          : 'Stale'
        : runtimeStatus.state === 'rebuilding'
          ? isZh
            ? '重建中（Rebuilding）'
            : 'Rebuilding'
          : runtimeStatus.state === 'failed'
            ? isZh
              ? '重建失败（Failed）'
              : 'Failed'
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

        {stale || rebuilding || failed ? (
          <div
            className={`settings-notice settings-notice--${failed ? 'error' : 'warning'}`}
            data-testid={failed ? 'runtime-failed-bar' : 'pending-changes-bar'}
          >
            <p>
              {failed
                ? isZh
                  ? '运行时重建失败，当前会话仍保留旧运行时。'
                  : 'Runtime rebuild failed; the current session is still using its previous runtime.'
                : rebuilding
                  ? isZh
                    ? '运行时正在重建，旧运行时仍负责当前调用。'
                    : 'Runtime is rebuilding; the previous runtime remains responsible for current calls.'
                  : isZh
                ? '设置已保存，但当前 Agent 仍在使用旧的运行时 schema。'
                : 'Settings are saved, but the current Agent still uses the previous runtime schema.'}
            </p>
            {runtimeStatus.candidateError ? (
              <p className="muted" data-testid="runtime-candidate-error">
                {runtimeStatus.candidateError}
              </p>
            ) : null}
            {runtimeStatus.staleDomains.length > 0 ? (
              <p className="muted">
                {isZh ? '受影响设置：' : 'Affected settings: '}
                {runtimeStatus.staleDomains.join(', ')}
              </p>
            ) : null}
            <p className="muted" data-testid="runtime-reload-unavailable-note">
              {isZh
                ? failed
                  ? '请检查错误后重试运行时重建，或新建会话应用设置。'
                  : '运行时重建完成前，安全收紧会立即生效。'
                : failed
                  ? 'Retry the runtime rebuild after resolving the error, or start a new session.'
                  : 'Safety tightening takes effect immediately while the runtime rebuild completes.'}
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
