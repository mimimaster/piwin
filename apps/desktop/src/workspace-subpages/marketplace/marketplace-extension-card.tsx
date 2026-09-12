/**
 * Pure typography-first card component for a Pi Extension in the marketplace.
 * Clean, icon-free design aligned with Settings -> Pi 扩展.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { resourceSourceLabel } from '@piwin/contracts';
import type { DesktopLocale } from '../../desktop-locale.js';
import type { MarketExtensionItem, MarketExtensionSource } from './marketplace-types.js';

function marketSourceLabel(source: MarketExtensionSource, locale: DesktopLocale | undefined): string {
  if (source === 'npm' || source === 'git') return source;
  return resourceSourceLabel(source, locale === 'zh-CN' ? 'zh-CN' : 'en');
}

export type MarketplaceExtensionCardProps = {
  extension: MarketExtensionItem;
  locale?: DesktopLocale | undefined;
  onInstall: (ext: MarketExtensionItem) => void;
  onUninstall: (ext: MarketExtensionItem) => void;
  onToggleActive?: ((ext: MarketExtensionItem) => void) | undefined;
};

export function MarketplaceExtensionCard({
  extension,
  locale,
  onInstall,
  onUninstall,
}: MarketplaceExtensionCardProps): ReactElement {
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const renderTierBadge = () => {
    switch (extension.tier) {
      case 'compatible':
        return (
          <span
            className="market-tier-badge is-compatible"
            title={t('Fully compatible in Piwin desktop', '在 Piwin 桌面端完全原生兼容')}
          >
            {t('Compatible', '原生兼容')}
          </span>
        );
      case 'degraded':
        return (
          <span
            className="market-tier-badge is-degraded"
            title={t('Compatible with degraded terminal features', '核心工具可用，终端特有功能优雅降级')}
          >
            {t('Degraded', '降级可用')}
          </span>
        );
      case 'incompatible':
        return (
          <span
            className="market-tier-badge is-incompatible"
            title={t('Incompatible with Piwin desktop shell', '依赖终端专有渲染，桌面端无法呈现')}
          >
            {t('Incompatible', '不兼容')}
          </span>
        );
      default:
        return (
          <span className="market-tier-badge is-unverified">
            {t('Unverified', '待验证')}
          </span>
        );
    }
  };

  const renderSourcePill = () => {
    const label = marketSourceLabel(extension.source, locale);
    const tone =
      extension.source === 'bundled'
        ? 'bundled'
        : extension.source === 'user'
          ? 'user'
          : extension.source === 'pi-native'
            ? 'native'
            : extension.source === 'npm'
              ? 'npm'
              : 'git';
    return <span className={`market-source-pill is-${tone}`}>{label}</span>;
  };

  const degradationLabel = (tag: string) => {
    switch (tag) {
      case 'shortcut':
        return t('Shortcuts ignored', '快捷键忽略');
      case 'custom-renderer':
        return t('Standard card render', '渲染转卡片');
      case 'tui-widget':
        return t('TUI status skipped', 'TUI 状态跳过');
      case 'slash-command-unlisted':
        return t('Slash command in chat', '指令支持');
      case 'theme':
        return t('Native theme applies', '主题忽略');
      default:
        return tag;
    }
  };

  return (
    <div className="market-card" data-testid={`market-ext-${extension.id}`}>
      <div>
        <div className="market-card-top">
          <div className="market-card-identity">
            <div className="market-card-header-texts">
              <div className="market-card-title-row">
                <strong className="market-card-title">{extension.name}</strong>
                {renderSourcePill()}
                {extension.installed && extension.active && (
                  <span className="market-status-pill is-active">
                    {t('Active', '已启用')}
                  </span>
                )}
                {renderTierBadge()}
              </div>
              <span className="market-card-meta">
                {extension.id} • v{extension.version} • {extension.author}
              </span>
            </div>
          </div>
        </div>

        <p className="market-card-desc">
          {isZh ? extension.descriptionZh : extension.descriptionEn}
        </p>

        <div className="market-card-tags">
          {extension.tools.map((tool) => (
            <span key={tool} className="market-code-tag">
              tool:{tool}
            </span>
          ))}
          {extension.hooks.map((hook) => (
            <span key={hook} className="market-code-tag">
              hook:{hook}
            </span>
          ))}
          {extension.degradations.map((deg) => (
            <span key={deg} className="market-warning-tag">
              {degradationLabel(deg)}
            </span>
          ))}
          {extension.tier === 'incompatible' && (
            <span className="market-incompatible-tag">
              {t('Terminal TUI Only', '仅限终端 TUI')}
            </span>
          )}
        </div>
      </div>

      <div className="market-card-footer">
        <span className="market-card-source">
          {extension.bundled
            ? t('bundled', '应用内置')
            : extension.source === 'user'
              ? t('User Extension', '用户级扩展')
              : extension.source === 'pi-native'
                ? t('Pi Native', 'Pi 原生扩展')
                : t('Community', '社区分发')}
        </span>

        <div className="market-card-actions">
          {extension.installed && extension.active ? (
            <div className="market-card-action-group">
              {!extension.bundled && (
                <Button
                  variant="ghost"
                  size="compact"
                  onClick={() => onUninstall(extension)}
                >
                  {t('Uninstall', '卸载')}
                </Button>
              )}
            </div>
          ) : extension.tier === 'incompatible' ? (
            <Button
              variant="secondary"
              size="compact"
              disabled
              title={t(
                'Incompatible: This extension depends on terminal TUI or raw TTY rendering and cannot run in the desktop shell.',
                '不可安装：该扩展依赖终端 TUI / 原始 TTY 渲染，桌面端无法呈现。',
              )}
            >
              {t('Incompatible', '不可安装')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="compact"
              onClick={() => onInstall(extension)}
            >
              {extension.tier === 'degraded'
                ? t('Install (Degraded)', '降级安装')
                : t('Install & Reload', '即时安装')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
