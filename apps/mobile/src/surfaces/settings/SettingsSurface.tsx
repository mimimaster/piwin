import type { ReactElement } from 'react';
import type { HostClientState } from '@piwin/host-client';
import type { RemoteHostStatusData } from '@piwin/contracts';
import { Button, Card, IconCheck, IconSettings } from '@piwin/ui-kit';
import type { MobileThemeMode } from '../../hooks/use-theme.js';

export type SettingsSurfaceProps = {
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
    desc: '自动跟随 iOS 系统外观设置',
    icon: '🌗',
    previewBg: 'linear-gradient(135deg, #090d12 50%, #ffffff 50%)',
    previewAccent: '#58a6ff',
  },
  {
    id: 'dark',
    name: '深色暗夜',
    desc: '经典深空黑，蓝调高亮与极光微光',
    icon: '🌙',
    badge: '推荐',
    previewBg: '#090d12',
    previewAccent: '#58a6ff',
  },
  {
    id: 'light',
    name: '清爽宣白',
    desc: '高对比度纯净浅色，阅读更通透',
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

export function SettingsSurface({
  hostStatus,
  connectionState,
  endpoint,
  projectCount,
  sessionCount,
  themeMode,
  onSelectTheme,
  onDisconnect,
  onOpenConnection,
}: SettingsSurfaceProps): ReactElement {
  const isConnected = connectionState.kind === 'ready';

  return (
    <div className="mobile-surface-container settings-surface">
      {/* 1. Theme Selection Section */}
      <Card className="mobile-slice-card" withBorder>
        <div className="mobile-card-heading">
          <div>
            <p className="mobile-eyebrow">APPEARANCE & THEME</p>
            <h2>外观与主题</h2>
          </div>
        </div>

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
      </Card>

      {/* 2. Host Connection & Authority Status */}
      <Card className="mobile-slice-card" withBorder>
        <div className="mobile-card-heading">
          <div>
            <p className="mobile-eyebrow">HOST AUTHORITY</p>
            <h2>Piwin Host 连接状态</h2>
          </div>
          <Button variant="secondary" size="compact" onClick={onOpenConnection}>
            <IconSettings size={14} />
            切换 Host
          </Button>
        </div>

        <dl className="mobile-stat-grid">
          <div>
            <dt>连接状态</dt>
            <dd style={{ color: isConnected ? 'var(--ok)' : 'var(--warning)' }}>
              {isConnected ? '已连接' : '未就绪'}
            </dd>
          </div>
          <div>
            <dt>项目数</dt>
            <dd>{projectCount}</dd>
          </div>
          <div>
            <dt>会话数</dt>
            <dd>{sessionCount}</dd>
          </div>
          <div>
            <dt>协议版本</dt>
            <dd>{hostStatus?.protocolVersion ?? '1.0.0'}</dd>
          </div>
        </dl>

        <div className="mobile-settings-endpoint-info">
          <span className="mobile-endpoint-label">当前连接端点</span>
          <code className="mobile-endpoint-value">{endpoint || '未配置'}</code>
        </div>

        {isConnected ? (
          <div className="mobile-settings-actions">
            <Button variant="danger" size="compact" onClick={onDisconnect}>
              断开当前 Host
            </Button>
          </div>
        ) : null}
      </Card>

      {/* 3. Mobile Shell Specification */}
      <Card className="mobile-slice-card" withBorder>
        <p className="mobile-eyebrow">ABOUT PIWIN MOBILE</p>
        <h2>iOS 原生移动端外壳</h2>
        <ul className="mobile-slice-list">
          <li><strong>架构隔离</strong>：手机壳纯粹负责观察、审批与交互，Node/Pi/MCP 运算完全留在 Host。</li>
          <li><strong>扫码配对</strong>：原生摄像头条码识别，支持一键扫码连接桌面端与云端。</li>
          <li><strong>多主题引擎</strong>：深度定制深色、浅色与砚夜泼墨水墨画主题。</li>
        </ul>
      </Card>
    </div>
  );
}
