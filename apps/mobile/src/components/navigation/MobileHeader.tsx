import type { ReactElement } from 'react';
import type { HostClientState } from '@piwin/host-client';
import { Button, IconStop } from '@piwin/ui-kit';

export type MobileSurfaceTab = 'inbox' | 'sessions' | 'chat' | 'settings';

export type MobileHeaderProps = {
  activeTab: MobileSurfaceTab;
  connectionState: HostClientState;
  activeSessionName?: string | undefined;
  activeRunId?: string | undefined;
  projectName?: string | undefined;
  onAbort?: (() => void) | undefined;
  onConnectClick?: (() => void) | undefined;
};

export function MobileHeader({
  activeTab,
  connectionState,
  activeSessionName,
  activeRunId,
  projectName,
  onAbort,
  onConnectClick,
}: MobileHeaderProps): ReactElement {
  const connectionView = describeConnectionState(connectionState);
  const isRunning = activeRunId !== undefined;

  const getTitle = () => {
    switch (activeTab) {
      case 'inbox':
        return '收件箱';
      case 'sessions':
        return '会话浏览';
      case 'chat':
        return activeSessionName ?? 'Agent Cockpit';
      case 'settings':
        return '设置 & 状态';
    }
  };

  return (
    <header className="mobile-header">
      <div className="mobile-header-left">
        <div className="mobile-header-eyebrow-row">
          <span className="mobile-header-eyebrow">PIWIN SHELL</span>
          {projectName ? <span className="mobile-header-project-pill">{projectName}</span> : null}
        </div>
        <h1 className="mobile-header-title">{getTitle()}</h1>
      </div>

      <div className="mobile-header-right">
        {isRunning && onAbort !== undefined ? (
          <Button variant="danger" size="compact" onClick={onAbort} className="mobile-header-stop-btn">
            <IconStop size={14} />
            <span>停止</span>
          </Button>
        ) : null}

        <button
          type="button"
          className="mobile-header-status-pill"
          onClick={onConnectClick}
          aria-label="查看连接状态"
        >
          <span className={`mobile-status-indicator ${connectionView.tone}`} />
          <span className="mobile-status-text">{connectionView.label}</span>
        </button>
      </div>
    </header>
  );
}

function describeConnectionState(state: HostClientState): {
  label: string;
  tone: 'running' | 'success' | 'warning' | 'danger' | 'neutral';
} {
  switch (state.kind) {
    case 'connecting':
      return { label: '连接中', tone: 'running' };
    case 'ready':
      return { label: '已连接', tone: 'success' };
    case 'resync-required':
      return { label: '同步中', tone: 'warning' };
    case 'error':
      return { label: '连接异常', tone: 'danger' };
    case 'disconnected':
      return { label: '未连接', tone: 'warning' };
    case 'idle':
      return { label: '空闲', tone: 'neutral' };
  }
}
