import type { ReactElement } from 'react';
import type { RemotePermissionRequest } from '../../hooks/use-mobile-host.js';
import { Button, IconClose, IconCheck, IconStop, IconListTree } from '@piwin/ui-kit';

export type InboxModalProps = {
  isOpen: boolean;
  onClose: () => void;
  activeRunId?: string | undefined;
  permissionRequest?: RemotePermissionRequest | undefined;
  isResolvingPermission: boolean;
  onResolvePermission: (decision: 'allow' | 'deny') => void;
  onAbortRun: () => void;
  onNavigateToChat: () => void;
};

export function InboxModal({
  isOpen,
  onClose,
  activeRunId,
  permissionRequest,
  isResolvingPermission,
  onResolvePermission,
  onAbortRun,
  onNavigateToChat,
}: InboxModalProps): ReactElement | null {
  if (!isOpen) return null;

  const isRunning = activeRunId !== undefined;

  return (
    <div className="mobile-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mobile-modal-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="mobile-modal-header">
          <div className="mobile-modal-header-left">
            <IconListTree size={18} />
            <h2 className="mobile-modal-title">任务收件箱</h2>
          </div>
          <button type="button" className="mobile-modal-close-btn" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="mobile-modal-body">
          {/* 1. Pending Permission Request */}
          {permissionRequest ? (
            <div className="inbox-permission-card">
              <div className="inbox-card-tag warning">⚠️ 权限请求等待审批</div>
              <h4 className="inbox-action-name">
                Host 请求执行：<code>{permissionRequest.action}</code>
              </h4>
              {permissionRequest.detail ? (
                <p className="inbox-action-detail">{permissionRequest.detail}</p>
              ) : null}
              <div className="inbox-card-actions">
                <Button
                  variant="danger"
                  size="compact"
                  disabled={isResolvingPermission}
                  onClick={() => onResolvePermission('deny')}
                >
                  <IconClose size={14} />
                  拒绝
                </Button>
                <Button
                  variant="primary"
                  size="compact"
                  disabled={isResolvingPermission}
                  onClick={() => onResolvePermission('allow')}
                >
                  <IconCheck size={14} />
                  允许执行
                </Button>
              </div>
            </div>
          ) : null}

          {/* 2. Active Run */}
          {isRunning ? (
            <div className="inbox-active-card">
              <div className="inbox-card-tag active">● 正在执行任务</div>
              <p className="inbox-run-id">运行 ID: {activeRunId}</p>
              <div className="inbox-card-actions">
                <Button variant="danger" size="compact" onClick={onAbortRun}>
                  <IconStop size={14} />
                  终止任务
                </Button>
                <Button
                  variant="primary"
                  size="compact"
                  onClick={() => {
                    onNavigateToChat();
                    onClose();
                  }}
                >
                  进入对话监控
                </Button>
              </div>
            </div>
          ) : null}

          {/* 3. Empty State */}
          {!isRunning && !permissionRequest ? (
            <div className="inbox-empty-view">
              <span className="inbox-empty-icon">✓</span>
              <h4>暂无进行中的任务</h4>
              <p>所有后台执行与权限拦截均已处理完毕。</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
