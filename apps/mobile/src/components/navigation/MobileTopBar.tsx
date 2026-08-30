import type { ReactElement } from 'react';
import type { HostClientState } from '@piwin/host-client';
import type { ThinkingLevel } from '@piwin/contracts';
import { IconMenuList, IconMic, IconPlus, IconSpark } from '@piwin/ui-kit';

export type MobileTopBarProps = {
  sessionTitle?: string | undefined;
  projectName?: string | undefined;
  activeModelName?: string | undefined;
  thinkingLevel?: ThinkingLevel | undefined;
  connectionState: HostClientState;
  activeRunCount?: number | undefined;
  onToggleSidebar: () => void;
  onOpenModelPicker?: () => void;
  onOpenLive?: () => void;
  liveActive?: boolean;
  liveStarting?: boolean;
  onNewChat: () => void;
  onOpenSettings: () => void;
};

export function MobileTopBar({
  sessionTitle,
  projectName,
  activeModelName,
  thinkingLevel,
  connectionState,
  activeRunCount = 0,
  onToggleSidebar,
  onOpenModelPicker,
  onOpenLive,
  liveActive = false,
  liveStarting = false,
  onNewChat,
  onOpenSettings,
}: MobileTopBarProps): ReactElement {
  const isConnected = connectionState.kind === 'ready';
  const showThinkingBadge = thinkingLevel !== undefined && thinkingLevel !== 'off';

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
          {activeRunCount > 0 ? <span className="mobile-top-btn-badge" /> : null}
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
              {activeModelName ||
                sessionTitle ||
                (projectName ? `${projectName} · 对话` : 'Piwin Agent')}
            </span>
            {showThinkingBadge ? (
              <span className="mobile-pill-thinking-badge">{thinkingLevel.toUpperCase()}</span>
            ) : null}
            <span className="mobile-pill-chevron">▾</span>
          </button>
        </div>

        {/* Right: Actions (Status Dot + New Chat) */}
        <div className="mobile-top-right">
          {onOpenLive !== undefined ? (
            <button
              type="button"
              className={`mobile-top-btn mobile-top-live-btn${liveActive ? ' is-active' : ''}${liveStarting ? ' is-starting' : ''}`}
              onClick={onOpenLive}
              aria-label={liveActive ? '打开 Live 语音通话' : '开始 Live 语音通话'}
              aria-pressed={liveActive}
            >
              <IconMic size={19} />
            </button>
          ) : null}
          <button
            type="button"
            className="mobile-top-status-dot-btn"
            onClick={onOpenSettings}
            aria-label="Host 连接状态与设置"
          >
            <span
              className={`mobile-status-dot ${
                isConnected ? 'online' : connectionState.kind === 'error' ? 'error' : 'offline'
              }`}
            />
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
