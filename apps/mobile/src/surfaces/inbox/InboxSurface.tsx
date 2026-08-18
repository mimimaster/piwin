import type { ReactElement } from 'react';
import type { ActivitySummaryItem, RemoteSessionSummary } from '@piwin/contracts';
import { Button, Card, StatusBadge, RadialBellow, ListRow } from '@piwin/ui-kit';
import {
  describeActivityItem,
  resolveActivitySessionName,
} from '../../mobile-activity-summary.js';

export type InboxSurfaceProps = {
  items: ActivitySummaryItem[];
  sessions: RemoteSessionSummary[];
  activeSessionId?: string | undefined;
  isResolvingPermission: boolean;
  onSelectSession: (sessionId: string) => void;
  onResolvePermission: (requestId: string, decision: 'allow' | 'deny') => void;
  onAbortRun: (sessionId: string, runId?: string) => void;
  onNavigateToChat: (sessionId: string) => void;
};

export function InboxSurface({
  items,
  sessions,
  activeSessionId,
  isResolvingPermission,
  onSelectSession,
  onResolvePermission,
  onAbortRun,
  onNavigateToChat,
}: InboxSurfaceProps): ReactElement {
  return (
    <div className="mobile-surface-container inbox-surface">
      {items.length === 0 ? (
        <Card className="mobile-inbox-idle-card" withBorder>
          <div className="mobile-idle-content">
            <div className="mobile-idle-icon">✓</div>
            <h3>当前没有等待处理的任务</h3>
            <p>Host 上没有跨会话的运行或待批权限。</p>
          </div>
        </Card>
      ) : (
        items.map((item) => {
          const requestId = item.permissionRequestId;
          return (
            <Card
              key={`${item.sessionId}:${item.runId ?? requestId ?? 'row'}`}
              className={item.pendingPermission ? 'mobile-permission-card' : 'mobile-active-run-card'}
              withBorder
            >
              <div className="mobile-card-heading">
                <div className="mobile-run-title-group">
                  {item.pendingPermission ? null : <RadialBellow size="sm" label="Run is active" />}
                  <div>
                    <p className="mobile-eyebrow">{describeActivityItem(item)}</p>
                    <h2>{resolveActivitySessionName(item, sessions)}</h2>
                  </div>
                </div>
                <StatusBadge
                  label={item.pendingPermission ? '待审批' : 'Running'}
                  tone={item.pendingPermission ? 'warning' : 'running'}
                />
              </div>
              <div className="mobile-active-run-actions">
                {item.pendingPermission && requestId !== undefined ? (
                  <>
                    <Button
                      variant="danger"
                      size="compact"
                      onClick={() => onResolvePermission(requestId, 'deny')}
                      disabled={isResolvingPermission}
                    >
                      拒绝
                    </Button>
                    <Button
                      variant="primary"
                      size="compact"
                      onClick={() => onResolvePermission(requestId, 'allow')}
                      disabled={isResolvingPermission}
                    >
                      {isResolvingPermission ? '处理中…' : '允许一次'}
                    </Button>
                  </>
                ) : null}
                {item.runId !== undefined ? (
                  <Button variant="danger" size="compact" onClick={() => onAbortRun(item.sessionId, item.runId)}>
                    停止任务
                  </Button>
                ) : null}
                <Button variant="primary" size="compact" onClick={() => onNavigateToChat(item.sessionId)}>
                  进入对话流
                </Button>
              </div>
            </Card>
          );
        })
      )}

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
                onNavigateToChat(session.sessionId);
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
