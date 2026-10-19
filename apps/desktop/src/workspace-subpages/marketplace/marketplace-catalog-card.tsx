/**
 * Discover-tab card: name, one-line purpose, kind, real Host state and one
 * primary action. The whole card opens the detail drawer, where install
 * consent, examples and provenance live.
 */
import type { KeyboardEvent, ReactElement } from 'react';
import type { MarketplaceCatalogEntry, MarketplaceInstalledItem } from '@piwin/contracts';
import { Button, ProgressBar } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import {
  availabilityLabel,
  entryName,
  isPiwinTested,
  kindLabel,
  localizedText,
  operationLabel,
} from './marketplace-copy.js';
import { MarketplaceKindSeal } from './marketplace-kind-seal.js';
import type { MarketOperation } from './marketplace-types.js';
import { hasCatalogUpdate } from './marketplace-view-model.js';
export { hasCatalogUpdate } from './marketplace-view-model.js';

export type MarketplaceCatalogCardProps = {
  entry: MarketplaceCatalogEntry;
  installed: MarketplaceInstalledItem | undefined;
  operation: MarketOperation | undefined;
  locale?: DesktopLocale | undefined;
  onOpen: (entry: MarketplaceCatalogEntry) => void;
  onUpdate?:
    ((entry: MarketplaceCatalogEntry, installed: MarketplaceInstalledItem) => void) | undefined;
};

/** Enter / Space on a focused card behaves like a click, as on a button. */
export function activateOnKey(event: KeyboardEvent<HTMLElement>, activate: () => void): void {
  if (event.target !== event.currentTarget) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    activate();
  }
}

export function MarketplaceCatalogCard(props: MarketplaceCatalogCardProps): ReactElement {
  const { entry, installed, operation, locale } = props;
  const zh = locale === 'zh-CN';
  const name = entryName(entry, locale);
  const open = () => props.onOpen(entry);
  const updatable = installed !== undefined && hasCatalogUpdate(entry, installed);

  return (
    <div
      className="market-card is-clickable"
      role="button"
      tabIndex={0}
      aria-label={name}
      onClick={open}
      onKeyDown={(event) => activateOnKey(event, open)}
      data-testid={`market-entry-${entry.entryId}`}
    >
      <div className="market-card-content">
        <div className="market-card-top">
          <MarketplaceKindSeal kind={entry.kind} />
          <div className="market-card-header-texts">
            <strong className="market-card-title" title={name}>
              {name}
            </strong>
            <span className="market-card-kind">
              {kindLabel(entry.kind, locale)}
              <span aria-hidden="true"> · </span>
              {entry.author}
            </span>
          </div>
          {isPiwinTested(entry.verification) ? (
            <span className="market-tested-badge">{zh ? 'piwin 实测' : 'piwin tested'}</span>
          ) : null}
        </div>
        <p className="market-card-desc">{localizedText(entry.summary, locale)}</p>
        {operation ? (
          // Installs report no byte progress, so the bar sweeps instead of guessing a percentage.
          <ProgressBar
            label={operationLabel(operation, locale)}
            className="market-card-progress"
            testId={`market-entry-progress-${entry.entryId}`}
          />
        ) : null}
      </div>
      <div className="market-card-footer">
        <span className="market-card-source">
          {entry.requirements.some((requirement) => requirement.required)
            ? zh
              ? '需前提条件'
              : 'Has prerequisites'
            : null}
        </span>
        <div className="market-card-actions">
          {operation ? null : updatable && installed ? (
            <Button
              variant="primary"
              size="compact"
              onClick={(event) => {
                event.stopPropagation();
                if (props.onUpdate) props.onUpdate(entry, installed);
                else open();
              }}
            >
              {zh ? `更新至 v${entry.version}` : `Update to v${entry.version}`}
            </Button>
          ) : installed ? (
            <span className={`market-status-pill is-${installed.availability}`}>
              {installed.availability === 'available'
                ? zh
                  ? '已安装'
                  : 'Installed'
                : availabilityLabel(installed.availability, locale)}
            </span>
          ) : (
            <Button
              variant="secondary"
              size="compact"
              onClick={(event) => {
                event.stopPropagation();
                open();
              }}
            >
              {zh ? '安装' : 'Install'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
