import type { ReactElement } from 'react';
import type { HostClientState } from '@piwin/host-client';
import type { RemoteHostStatusData } from '@piwin/contracts';
import { Button, IconClose, IconCheck, IconSettings } from '@piwin/ui-kit';
import type { MobileThemeMode } from '../../hooks/use-theme.js';

export type SettingsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  hostStatus?: RemoteHostStatusData | undefined;
  connectionState: HostClientState;
  endpoint: string;
  projectCount: number;
  sessionCount: number;
  themeMode: MobileThemeMode;
  onSelectTheme: (mode: MobileThemeMode) => void;
  onDisconnect: () => void;
  onOpenConnection: () => void;
};

const THEME_OPTIONS: Array<{
  id: MobileThemeMode;
  name: string;
  desc: string;
  icon: string;
  badge?: string | undefined;
  previewBg: string;
  previewAccent: string;
}> = [
  {
    id: 'system',
    name: '系统跟随',
    desc: '自动跟随 iOS 系统深浅色外观',
    icon: '🌗',
    previewBg: 'linear-gradient(135deg, #090d12 50%, #ffffff 50%)',
    previewAccent: '#58a6ff',
  },
  {
    id: 'dark',
    name: '深色暗夜',
    desc: '经典深空黑与极光蓝光效',
    icon: '🌙',
    badge: '推荐',
    previewBg: '#090d12',
    previewAccent: '#58a6ff',
  },
  {
    id: 'light',
    name: '清爽宣白',
    desc: '高对比度纯净浅色，排版通透',
    icon: '☀️',
    previewBg: '#ffffff',
    previewAccent: '#0969da',
  },
  {
    id: 'ink-wash',
    name: '砚夜泼墨',
    desc: '水墨山水，淡竹墨韵与朱砂钤印',
    icon: '🖌️',
    badge: '水墨画',
    previewBg: '#191a1d',
    previewAccent: '#78a9b7',
  },
];

export function SettingsModal({
  isOpen,
  onClose,
  hostStatus,
  connectionState,
  endpoint,
  projectCount,
  sessionCount,
  themeMode,
  onSelectTheme,
  onDisconnect,
  onOpenConnection,
}: SettingsModalProps): ReactElement | null {
  if (!isOpen) return null;

  const isConnected = connectionState.kind === 'ready';

  return (
    <div className="mobile-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="mobile-modal-sheet" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="mobile-modal-header">
          <div className="mobile-modal-header-left">
            <IconSettings size={18} />
            <h2 className="mobile-modal-title">设置与外观</h2>
          </div>
          <button type="button" className="mobile-modal-close-btn" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </div>

        {/* Modal Content Scroll Area */}
        <div className="mobile-modal-body">
          {/* Section 1: Themes */}
          <div className="mobile-modal-section">
            <h3 className="mobile-modal-section-title">主题风格</h3>
            <div className="mobile-theme-picker-grid">
              {THEME_OPTIONS.map((theme) => {
                const isSelected = themeMode === theme.id;
                return (
                  <button
                    type="button"
                    key={theme.id}
                    className={`mobile-theme-card-tile ${isSelected ? 'selected' : ''}`}
                    onClick={() => onSelectTheme(theme.id)}
                    aria-selected={isSelected}
                  >
                    <div className="mobile-theme-tile-header">
                      <div
                        className="mobile-theme-tile-circle"
                        style={{ background: theme.previewBg }}
                      >
                        <span
                          className="mobile-theme-tile-dot"
                          style={{ background: theme.previewAccent }}
                        />
                      </div>
                      {theme.badge ? (
                        <span className="mobile-theme-badge">{theme.badge}</span>
                      ) : null}
                      {isSelected ? (
                        <div className="mobile-theme-selected-check">
                          <IconCheck size={12} />
                        </div>
                      ) : null}
                    </div>

                    <div className="mobile-theme-tile-info">
                      <div className="mobile-theme-tile-title-row">
                        <span className="mobile-theme-icon">{theme.icon}</span>
                        <span className="mobile-theme-tile-name">{theme.name}</span>
                      </div>
                      <p className="mobile-theme-tile-desc">{theme.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Section 2: Host Connection Info */}
          <div className="mobile-modal-section">
            <div className="mobile-modal-section-heading">
              <h3 className="mobile-modal-section-title">Host 连接与状态</h3>
              <Button variant="secondary" size="compact" onClick={() => { onOpenConnection(); onClose(); }}>
                切换 Host
              </Button>
            </div>

            <div className="mobile-modal-stat-grid">
              <div className="stat-box">
                <span className="stat-label">连接状态</span>
                <span className={`stat-val ${isConnected ? 'online' : 'offline'}`}>
                  {isConnected ? '已连接' : '未连接'}
                </span>
              </div>
              <div className="stat-box">
                <span className="stat-label">挂载项目</span>
                <span className="stat-val">{projectCount}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">历史会话</span>
                <span className="stat-val">{sessionCount}</span>
              </div>
              <div className="stat-box">
                <span className="stat-label">协议版本</span>
                <span className="stat-val">{hostStatus?.protocolVersion ?? '1.0.0'}</span>
              </div>
            </div>

            <div className="mobile-modal-endpoint-box">
              <span className="endpoint-label">连接端点：</span>
              <code className="endpoint-code">{endpoint || '未配置'}</code>
            </div>

            {isConnected ? (
              <div className="mobile-modal-danger-row">
                <Button variant="danger" size="compact" onClick={onDisconnect}>
                  断开当前 Host
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
