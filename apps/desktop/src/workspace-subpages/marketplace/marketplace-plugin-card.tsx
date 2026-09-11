/**
 * Pure typography-first card component for a Pi Plugin in the marketplace.
 * Clean, icon-free design.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import type { MarketPluginItem } from './marketplace-types.js';

export type MarketplacePluginCardProps = {
  plugin: MarketPluginItem;
  locale?: DesktopLocale | undefined;
  onInstall: (plugin: MarketPluginItem) => void;
  onUninstall: (plugin: MarketPluginItem) => void;
};

export function MarketplacePluginCard({
  plugin,
  locale,
  onInstall,
  onUninstall,
}: MarketplacePluginCardProps): ReactElement {
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);

  const hasSecretRequirement = plugin.secrets.some((s) => s.required);

  return (
    <div className="market-card" data-testid={`market-plugin-${plugin.id}`}>
      <div>
        <div className="market-card-top">
          <div className="market-card-identity">
            <div className="market-card-header-texts">
              <div className="market-card-title-row">
                <strong className="market-card-title">{plugin.name}</strong>
                <span className="market-source-pill is-native">plugin</span>
                {plugin.installed && (
                  <span className="market-status-pill is-active">
                    {t('Installed', '已装载')}
                  </span>
                )}
              </div>
              <span className="market-card-meta">
                {plugin.id} • v{plugin.version}
              </span>
            </div>
          </div>
        </div>

        <p className="market-card-desc">
          {isZh ? plugin.descriptionZh : plugin.descriptionEn}
        </p>

        <div className="market-card-tags">
          <span className="market-code-tag">
            {t(`${plugin.skillsCount} Skills`, `${plugin.skillsCount} 个 Skills`)}
          </span>
          <span className="market-code-tag">
            {t(`${plugin.mcpCount} MCP Server`, `${plugin.mcpCount} 个 MCP 服务`)}
          </span>
          {hasSecretRequirement && (
            <span className="market-warning-tag">
              {t('Requires API Key', '需配置密钥')}
            </span>
          )}
        </div>
      </div>

      <div className="market-card-footer">
        <span className="market-card-source">
          {t('Managed MCP Bundle', '托管 MCP 套件')}
        </span>

        <div className="market-card-actions">
          {plugin.installed ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => onUninstall(plugin)}
            >
              {t('Remove', '移除')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="compact"
              onClick={() => onInstall(plugin)}
            >
              {hasSecretRequirement
                ? t('Configure & Add', '配置并装载')
                : t('Add Plugin', '添加插件')}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
