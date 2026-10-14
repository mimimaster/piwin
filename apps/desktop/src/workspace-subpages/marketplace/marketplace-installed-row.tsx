/**
 * Installed-tab row for one Host inventory item. Actions come from the Host
 * (`canToggle`, `removal`); the row never infers them from the source label.
 * The row opens the catalog detail when one exists.
 */
import type { KeyboardEvent, ReactElement } from 'react';
import type { MarketplaceCatalogEntry, MarketplaceInstalledItem, SkillSource } from '@piwin/contracts';
import { SKILL_SOURCE_DISPLAY_ORDER, resourceSourceLabel } from '@piwin/contracts';
import { Button, ProgressRing } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { activateOnKey, hasCatalogUpdate } from './marketplace-catalog-card.js';
import { availabilityLabel, entryName, inventoryMessage, kindLabel, operationLabel } from './marketplace-copy.js';
import type { MarketOperation } from './marketplace-types.js';

function isResourceSource(source: string): source is SkillSource {
  return (SKILL_SOURCE_DISPLAY_ORDER as readonly string[]).includes(source);
}

function sourceLabel(source: string, locale: DesktopLocale | undefined): string {
  if (isResourceSource(source)) {
    return resourceSourceLabel(source, locale === 'zh-CN' ? 'zh-CN' : 'en');
  }
  return source;
}

export type MarketplaceInstalledRowProps = {
  item: MarketplaceInstalledItem;
  operation: MarketOperation | undefined;
  locale?: DesktopLocale | undefined;
  /** Catalog entry this item came from (also carries `withdrawn`). */
  catalogEntry?: MarketplaceCatalogEntry | undefined;
  onOpen?: ((entry: MarketplaceCatalogEntry) => void) | undefined;
  onToggle: (item: MarketplaceInstalledItem) => void;
  onRemove: (item: MarketplaceInstalledItem) => void;
  onUpdate?: ((entry: MarketplaceCatalogEntry, installed: MarketplaceInstalledItem) => void) | undefined;
  onConfigureMcp?: (() => void) | undefined;
};

export function MarketplaceInstalledRow(props: MarketplaceInstalledRowProps): ReactElement {
  const { item, operation, locale, catalogEntry } = props;
  const zh = locale === 'zh-CN';
  const message = inventoryMessage(item, locale);
  const name = catalogEntry ? entryName(catalogEntry, locale) : item.name;
  const openEntry = catalogEntry && props.onOpen ? () => props.onOpen?.(catalogEntry) : undefined;
  const updatable = catalogEntry !== undefined && props.onUpdate !== undefined && hasCatalogUpdate(catalogEntry, item);
  const tier = item.compatibilityTier === 'degraded' || item.compatibilityTier === 'incompatible'
    ? item.compatibilityTier
    : undefined;

  return (
    <div
      className={`market-installed-item${openEntry ? ' is-clickable' : ''}`}
      data-testid={`market-installed-${item.installationKey}`}
      {...(openEntry
        ? {
            role: 'button',
            tabIndex: 0,
            'aria-label': name,
            onClick: openEntry,
            onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => activateOnKey(event, openEntry),
          }
        : {})}
    >
      <div className="market-installed-info">
        <div className="market-installed-texts">
          <div className="market-card-title-row">
            <strong className="market-installed-name">{name}</strong>
            <span className="market-source-pill">{kindLabel(item.kind, locale)}</span>
            {/* MCP config is the only MCP source; the kind pill already says so. */}
            {item.source !== 'mcp-config' ? (
              <span className="market-source-pill">{sourceLabel(item.source, locale)}</span>
            ) : null}
            {tier ? (
              <span className={`market-tier-badge is-${tier}`}>
                {tier === 'degraded' ? (zh ? '部分兼容' : 'Partly compatible') : zh ? '不兼容' : 'Incompatible'}
              </span>
            ) : null}
            {catalogEntry?.withdrawn ? (
              <span className="market-tier-badge is-degraded" data-testid="market-installed-withdrawn">
                {zh ? '已下架' : 'Withdrawn'}
              </span>
            ) : null}
          </div>
          {item.version || message ? (
            <span className="market-card-meta">
              {item.version ? `v${item.version}` : ''}
              {item.version && message ? ' · ' : ''}
              {message ?? ''}
            </span>
          ) : null}
        </div>
      </div>
      <div className="market-installed-actions" onClick={(event) => event.stopPropagation()}>
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
            {updatable && catalogEntry ? (
              <Button variant="primary" size="compact" onClick={() => props.onUpdate?.(catalogEntry, item)}>
                {zh ? `更新至 v${catalogEntry.version}` : `Update to v${catalogEntry.version}`}
              </Button>
            ) : null}
            {item.kind === 'mcp' && props.onConfigureMcp ? (
              <Button variant="ghost" size="compact" onClick={props.onConfigureMcp}>
                {zh ? '配置' : 'Configure'}
              </Button>
            ) : null}
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
