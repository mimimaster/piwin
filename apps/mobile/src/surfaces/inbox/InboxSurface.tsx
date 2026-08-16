import type { ReactElement } from 'react';
import type { RemoteSessionSummary } from '@piwin/contracts';
import { Button, Card, StatusBadge, RadialBellow, ListRow } from '@piwin/ui-kit';
import type { RemotePermissionRequest } from '../../hooks/use-mobile-host.js';

export type InboxSurfaceProps = {
  activeRunId?: string | undefined;
  permissionRequest?: RemotePermissionRequest | undefined;
  isResolvingPermission: boolean;
  sessions: RemoteSessionSummary[];
  activeSessionId?: string | undefined;
  onSelectSession: (sessionId: string) => void;
  onResolvePermission: (decision: 'allow' | 'deny') => void;
  onAbortRun: () => void;
  onNavigateToChat: () => void;
};

export function InboxSurface({
  activeRunId,
  permissionRequest,
  isResolvingPermission,
  sessions,
  activeSessionId,
  onSelectSession,
  onResolvePermission,
  onAbortRun,
  onNavigateToChat,
}: InboxSurfaceProps): ReactElement {
  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);

  return (
    <div className="mobile-surface-container inbox-surface">
      {/* 1. Pending Permission Request (Highest Priority) */}
      {permissionRequest !== undefined ? (
        <Card className="mobile-permission-card" withBorder>
          <div className="mobile-card-heading">
            <div>
              <p className="mobile-eyebrow">ACTION REQUIRED</p>
              <h2>Host 请求权限</h2>
            </div>
            <StatusBadge label="待审批" tone="warning" />
          </div>
          <p className="mobile-permission-action">{permissionRequest.action}</p>
          <p className="mobile-permission-detail">{permissionRequest.detail}</p>
          <div className="mobile-permission-actions">
            <Button
              variant="danger"
              size="compact"
              onClick={() => onResolvePermission('deny')}
              disabled={isResolvingPermission}
            >
              拒绝
            </Button>
            <Button
              variant="primary"
              size="compact"
              onClick={() => onResolvePermission('allow')}
              disabled={isResolvingPermission}
            >
              {isResolvingPermission ? '处理中…' : '允许一次'}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* 2. Active Run (Foreground Running Task) */}
      {activeRunId !== undefined ? (
        <Card className="mobile-active-run-card" withBorder>
          <div className="mobile-card-heading">
            <div className="mobile-run-title-group">
              <RadialBellow size="sm" label="Run is active" />
              <div>
                <p className="mobile-eyebrow">ACTIVE RUN</p>
                <h2>{activeSession?.name ?? '任务执行中…'}</h2>
              </div>
            </div>
            <StatusBadge label="Running" tone="running" />
          </div>
          <p className="mobile-active-run-detail">
            Host 正在执行 Agent 编排任务，实时事件持续接收中。
          </p>
          <div className="mobile-active-run-actions">
            <Button variant="danger" size="compact" onClick={onAbortRun}>
              停止任务
            </Button>
            <Button variant="primary" size="compact" onClick={onNavigateToChat}>
              进入对话流
            </Button>
          </div>
        </Card>
      ) : null}

      {/* 3. Empty state if nothing active */}
      {activeRunId === undefined && permissionRequest === undefined ? (
        <Card className="mobile-inbox-idle-card" withBorder>
          <div className="mobile-idle-content">
            <div className="mobile-idle-icon">✓</div>
            <h3>当前没有等待处理的任务</h3>
            <p>所有后台任务已完成，Host 就绪。</p>
          </div>
        </Card>
      ) : null}

      {/* 4. Recent Active Sessions List */}
      <Card className="mobile-slice-card" withBorder>
        <div className="mobile-card-heading">
          <div>
            <p className="mobile-eyebrow">RECENT SESSIONS</p>
            <h2>最近会话</h2>
          </div>
          <span className="mobile-session-count">{sessions.length} 个会话</span>
        </div>

        <div className="mobile-session-list">
          {sessions.slice(0, 5).map((session) => (
            <ListRow
              key={session.sessionId}
              compact
              selected={session.sessionId === activeSessionId}
              onClick={() => {
                onSelectSession(session.sessionId);
                onNavigateToChat();
              }}
            >
              <span>{session.name ?? session.sessionId}</span>
            </ListRow>
          ))}
        </div>
      </Card>
    </div>
  );
}
