import type { ReactElement } from 'react';
import { IconChat, IconFolder, IconListTree, IconSettings } from '@piwin/ui-kit';
import type { MobileSurfaceTab } from './MobileHeader.js';

type MobileTabBarProps = {
  activeTab: MobileSurfaceTab;
  onSelectTab: (tab: MobileSurfaceTab) => void;
  unreadCount?: number | undefined;
  activeRunCount?: number | undefined;
};

export function MobileTabBar({
  activeTab,
  onSelectTab,
  activeRunCount = 0,
}: MobileTabBarProps): ReactElement {
  return (
    <nav className="mobile-tab-bar" aria-label="移动端底部导航">
      <button
        type="button"
        className={`mobile-tab-item ${activeTab === 'inbox' ? 'active' : ''}`}
        onClick={() => onSelectTab('inbox')}
        aria-selected={activeTab === 'inbox'}
      >
        <div className="mobile-tab-icon-wrap">
          <IconListTree size={20} />
          {activeRunCount > 0 ? <span className="mobile-tab-badge" /> : null}
        </div>
        <span className="mobile-tab-label">收件箱</span>
      </button>

      <button
        type="button"
        className={`mobile-tab-item ${activeTab === 'sessions' ? 'active' : ''}`}
        onClick={() => onSelectTab('sessions')}
        aria-selected={activeTab === 'sessions'}
      >
        <div className="mobile-tab-icon-wrap">
          <IconFolder size={20} />
        </div>
        <span className="mobile-tab-label">会话</span>
      </button>

      <button
        type="button"
        className={`mobile-tab-item ${activeTab === 'chat' ? 'active' : ''}`}
        onClick={() => onSelectTab('chat')}
        aria-selected={activeTab === 'chat'}
      >
        <div className="mobile-tab-icon-wrap">
          <IconChat size={20} />
        </div>
        <span className="mobile-tab-label">对话</span>
      </button>

      <button
        type="button"
        className={`mobile-tab-item ${activeTab === 'settings' ? 'active' : ''}`}
        onClick={() => onSelectTab('settings')}
        aria-selected={activeTab === 'settings'}
      >
        <div className="mobile-tab-icon-wrap">
          <IconSettings size={20} />
        </div>
        <span className="mobile-tab-label">设置</span>
      </button>
    </nav>
  );
}
