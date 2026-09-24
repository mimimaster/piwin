/**
 * Discover-tab card: name, one-line purpose, kind, evidence, real Host state
 * and one primary action. Details and install consent live in the dialog.
 */
import type { ReactElement } from 'react';
import type { MarketplaceCatalogEntry, MarketplaceInstalledItem } from '@piwin/contracts';
import { Button, ProgressBar, ProgressRing } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import {
  availabilityLabel,
  kindLabel,
  localizedText,
  operationLabel,
  verificationLabel,
} from './marketplace-copy.js';
import type { MarketOperation } from './marketplace-types.js';

export type MarketplaceCatalogCardProps = {
  entry: MarketplaceCatalogEntry;
  installed: MarketplaceInstalledItem | undefined;
  operation: MarketOperation | undefined;
  locale?: DesktopLocale | undefined;
  onOpen: (entry: MarketplaceCatalogEntry) => void;
};

export function MarketplaceCatalogCard(props: MarketplaceCatalogCardProps): ReactElement {
  const { entry, installed, operation, locale } = props;
  const zh = locale === 'zh-CN';
  return (
    <div className="market-card" data-testid={`market-entry-${entry.entryId}`}>
      <div className="market-card-content">
        <div className="market-card-top">
          <div className="market-card-identity">
            <div className="market-card-header-texts">
              <div className="market-card-title-row">
                <strong className="market-card-title">{localizedText(entry.name, locale)}</strong>
                <span className="market-source-pill">{kindLabel(entry.kind, locale)}</span>
                {installed ? (
                  <span className={`market-status-pill is-${installed.availability}`}>
                    {availabilityLabel(installed.availability, locale)}
                  </span>
                ) : null}
              </div>
              <span className="market-card-meta">
                {entry.author} • {entry.sourceLabel} • {verificationLabel(entry.verification, locale)}
              </span>
            </div>
          </div>
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
              ? '需要前提条件'
              : 'Has prerequisites'
            : ''}
        </span>
        <div className="market-card-actions">
          {operation ? (
            <Button variant="primary" size="compact" disabled aria-busy={true}>
              <span className="market-btn-inner market-btn-installing">
                <ProgressRing size={13} strokeWidth={2.2} tone="pine" />
                <span className="market-btn-progress-label">{operationLabel(operation, locale)}</span>
              </span>
            </Button>
          ) : (
            <Button
              variant={installed ? 'secondary' : 'primary'}
              size="compact"
              onClick={() => props.onOpen(entry)}
            >
              {installed ? (zh ? '详情' : 'Details') : zh ? '查看并安装' : 'View & install'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
