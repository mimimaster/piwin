/**
 * Installed-tab row for one Host inventory item. Actions come from the Host
 * (`canToggle`, `removal`); the row never infers them from the source label.
 */
import type { ReactElement } from 'react';
import type { MarketplaceInstalledItem, SkillSource } from '@piwin/contracts';
import { SKILL_SOURCE_DISPLAY_ORDER, resourceSourceLabel } from '@piwin/contracts';
import { Button, ProgressRing } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { availabilityLabel, kindLabel, operationLabel } from './marketplace-copy.js';
import type { MarketOperation } from './marketplace-types.js';

function isResourceSource(source: string): source is SkillSource {
  return (SKILL_SOURCE_DISPLAY_ORDER as readonly string[]).includes(source);
}

function sourceLabel(source: string, locale: DesktopLocale | undefined): string {
  if (isResourceSource(source)) {
    return resourceSourceLabel(source, locale === 'zh-CN' ? 'zh-CN' : 'en');
  }
  if (source === 'mcp-config') return 'MCP';
  return source;
}

export type MarketplaceInstalledRowProps = {
  item: MarketplaceInstalledItem;
  operation: MarketOperation | undefined;
  locale?: DesktopLocale | undefined;
  onToggle: (item: MarketplaceInstalledItem) => void;
  onRemove: (item: MarketplaceInstalledItem) => void;
};

export function MarketplaceInstalledRow(props: MarketplaceInstalledRowProps): ReactElement {
  const { item, operation, locale } = props;
  const zh = locale === 'zh-CN';
  return (
    <div className="market-installed-item" data-testid={`market-installed-${item.installationKey}`}>
      <div className="market-installed-info">
        <div className="market-installed-texts">
          <div className="market-card-title-row">
            <strong className="market-installed-name">{item.name}</strong>
            <span className="market-source-pill">{kindLabel(item.kind, locale)}</span>
            <span className="market-source-pill">{sourceLabel(item.source, locale)}</span>
          </div>
          <span className="market-card-meta">
            {item.capabilityId}
            {item.version ? ` • v${item.version}` : ''}
            {item.message ? ` • ${item.message}` : ''}
          </span>
        </div>
      </div>
      <div className="market-installed-actions">
        <span className={`market-status-pill is-${item.availability}`}>
          {availabilityLabel(item.availability, locale)}
        </span>
        {operation ? (
          <span className="market-btn-inner market-btn-installing" aria-busy={true}>
            <ProgressRing size={13} strokeWidth={2.2} tone="pine" />
            <span className="market-btn-progress-label">{operationLabel(operation, locale)}</span>
          </span>
        ) : (
          <>
            {item.canToggle && item.kind !== 'mcp' ? (
              <Button variant="ghost" size="compact" onClick={() => props.onToggle(item)}>
                {item.enabled ? (zh ? '停用' : 'Disable') : zh ? '启用' : 'Enable'}
              </Button>
            ) : null}
            {item.removal ? (
              <Button variant="ghost" size="compact" onClick={() => props.onRemove(item)}>
                {zh ? '卸载' : 'Uninstall'}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
