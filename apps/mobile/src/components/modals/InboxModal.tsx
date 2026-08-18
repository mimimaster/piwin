import type { ReactElement } from 'react';
import type { ActivitySummaryItem, RemoteSessionSummary } from '@piwin/contracts';
import { Button, IconClose, IconCheck, IconStop, IconListTree } from '@piwin/ui-kit';
import {
  describeActivityItem,
  resolveActivitySessionName,
} from '../../mobile-activity-summary.js';

export type InboxModalProps = {
  isOpen: boolean;
  onClose: () => void;
  items: ActivitySummaryItem[];
  sessions: RemoteSessionSummary[];
  isResolvingPermission: boolean;
  onResolvePermission: (requestId: string, decision: 'allow' | 'deny') => void;
  onAbortRun: (sessionId: string, runId?: string) => void;
  onNavigateToSession: (sessionId: string) => void;
};

export function InboxModal({
  isOpen,
  onClose,
  items,
  sessions,
  isResolvingPermission,
  onResolvePermission,
  onAbortRun,
  onNavigateToSession,
}: InboxModalProps): ReactElement | null {
  if (!isOpen) return null;

  return (
    <div className="mobile-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mobile-modal-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="mobile-modal-header">
          <div className="mobile-modal-header-left">
            <IconListTree size={18} />
            <h2 className="mobile-modal-title">任务收件箱</h2>
          </div>
          <button type="button" className="mobile-modal-close-btn" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </div>

        <div className="mobile-modal-body">
          {items.length === 0 ? (
            <div className="inbox-empty-view">
              <span className="inbox-empty-icon">✓</span>
              <h4>暂无进行中的任务</h4>
              <p>Host 上没有跨会话的运行或待批权限。</p>
            </div>
          ) : (
            items.map((item) => (
              <ActivityInboxCard
                key={`${item.sessionId}:${item.runId ?? item.permissionRequestId ?? 'row'}`}
                item={item}
                title={resolveActivitySessionName(item, sessions)}
                isResolvingPermission={isResolvingPermission}
                onResolvePermission={onResolvePermission}
                onAbortRun={onAbortRun}
                onNavigateToSession={(sessionId) => {
                  onNavigateToSession(sessionId);
                  onClose();
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ActivityInboxCard({
  item,
  title,
  isResolvingPermission,
  onResolvePermission,
  onAbortRun,
  onNavigateToSession,
}: {
  item: ActivitySummaryItem;
  title: string;
  isResolvingPermission: boolean;
  onResolvePermission: (requestId: string, decision: 'allow' | 'deny') => void;
  onAbortRun: (sessionId: string, runId?: string) => void;
  onNavigateToSession: (sessionId: string) => void;
}): ReactElement {
  const requestId = item.permissionRequestId;
  return (
    <div className={item.pendingPermission ? 'inbox-permission-card' : 'inbox-active-card'}>
      <div className={`inbox-card-tag ${item.pendingPermission ? 'warning' : 'active'}`}>
        {describeActivityItem(item)}
      </div>
      <h4 className="inbox-action-name">{title}</h4>
      {item.runId !== undefined ? <p className="inbox-run-id">运行 {item.runId}</p> : null}
      <div className="inbox-card-actions">
        {item.pendingPermission && requestId !== undefined ? (
          <>
            <Button
              variant="danger"
              size="compact"
              disabled={isResolvingPermission}
              onClick={() => onResolvePermission(requestId, 'deny')}
            >
              <IconClose size={14} />
              拒绝
            </Button>
            <Button
              variant="primary"
              size="compact"
              disabled={isResolvingPermission}
              onClick={() => onResolvePermission(requestId, 'allow')}
            >
              <IconCheck size={14} />
              允许一次
            </Button>
          </>
        ) : null}
        {item.runId !== undefined ? (
          <Button variant="danger" size="compact" onClick={() => onAbortRun(item.sessionId, item.runId)}>
            <IconStop size={14} />
            终止
          </Button>
        ) : null}
        <Button variant="primary" size="compact" onClick={() => onNavigateToSession(item.sessionId)}>
          进入对话
        </Button>
      </div>
    </div>
  );
}
