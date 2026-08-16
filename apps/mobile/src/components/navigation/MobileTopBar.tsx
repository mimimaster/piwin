import type { ReactElement } from 'react';
import type { HostClientState } from '@piwin/host-client';
import { IconMenuList, IconPlus, IconSpark } from '@piwin/ui-kit';

export type MobileTopBarProps = {
  sessionTitle?: string | undefined;
  projectName?: string | undefined;
  activeModelName?: string | undefined;
  connectionState: HostClientState;
  onToggleSidebar: () => void;
  onOpenModelPicker?: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
};

export function MobileTopBar({
  sessionTitle,
  projectName,
  activeModelName,
  connectionState,
  onToggleSidebar,
  onOpenModelPicker,
  onNewChat,
  onOpenSettings,
}: MobileTopBarProps): ReactElement {
  const isConnected = connectionState.kind === 'ready';

  return (
    <header className="mobile-top-bar">
      <div className="mobile-top-bar-inner">
        {/* Left: Sidebar Toggle Button */}
        <button
          type="button"
          className="mobile-top-btn"
          onClick={onToggleSidebar}
          aria-label="打开会话与导航侧边栏"
        >
          <IconMenuList size={22} />
        </button>

        {/* Center: Title / Model Pill */}
        <div className="mobile-top-center">
          <button
            type="button"
            className="mobile-session-pill-btn"
            onClick={onOpenModelPicker ?? onToggleSidebar}
            aria-label="切换模型与推理配置"
          >
            <IconSpark size={14} className="mobile-pill-spark" />
            <span className="mobile-pill-title">
              {activeModelName || sessionTitle || (projectName ? `${projectName} · 对话` : 'Piwin Agent')}
            </span>
            <span className="mobile-pill-chevron">▾</span>
          </button>
        </div>

        {/* Right: Actions (Status Dot + New Chat) */}
        <div className="mobile-top-right">
          <button
            type="button"
            className="mobile-top-status-dot-btn"
            onClick={onOpenSettings}
            aria-label="Host 连接状态与设置"
          >
            <span className={`mobile-status-dot ${isConnected ? 'online' : 'offline'}`} />
          </button>

          <button
            type="button"
            className="mobile-top-btn new-chat"
            onClick={onNewChat}
            aria-label="新建对话"
          >
            <IconPlus size={20} />
          </button>
        </div>
      </div>
    </header>
  );
}
