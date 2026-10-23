/**
 * Live-search result card (npm / GitHub / MCP Registry / Skill store). The
 * card opens the package drawer (README, source, install command); the one
 * button starts the risk-confirmed install.
 */
import type { ReactElement } from 'react';
import type { MarketplaceSearchHit } from '@piwin/contracts';
import { Button, ProgressRing } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../i18n/desktop-locale.js';
import { activateOnKey } from './marketplace-catalog-card.js';
import {
  formatRelativeDate,
  packageSourceLabel,
  packageTestId,
} from './marketplace-package-meta.js';
import type { MarketplacePackageInstallState } from './use-marketplace-package-install.js';

export type MarketplacePiPackageCardProps = {
  hit: MarketplaceSearchHit;
  locale?: DesktopLocale | undefined;
  onOpen: (hit: MarketplaceSearchHit) => void;
  onInstall: (hit: MarketplaceSearchHit) => void;
  installState?: MarketplacePackageInstallState | 'idle' | undefined;
};

export function isPackageInstallable(hit: MarketplaceSearchHit): boolean {
  if (hit.source === 'mcp-registry') return Boolean(hit.mcpDraft);
  return hit.source !== 'github' || Boolean(hit.repositoryUrl);
}

export function MarketplacePiPackageCard(props: MarketplacePiPackageCardProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const { hit } = props;
  const testId = packageTestId(hit);
  const installState = props.installState ?? 'idle';
  const installable = isPackageInstallable(hit);
  const number = Intl.NumberFormat(props.locale);
  const open = () => props.onOpen(hit);
  const updated = hit.updatedAt ? formatRelativeDate(hit.updatedAt, props.locale) : undefined;

  return (
    <div
      className="market-card market-community-card is-clickable"
      role="button"
      tabIndex={0}
      aria-label={hit.name}
      onClick={open}
      onKeyDown={(event) => activateOnKey(event, open)}
      data-testid={testId}
    >
      <div className="market-card-content">
        <div className="market-community-card-top">
          <strong className="market-community-name">{hit.name}</strong>
          <span className="market-community-origin">{packageSourceLabel(hit)}</span>
        </div>
        <div className="market-community-meta">
          {hit.publisher ? <span>{hit.publisher}</span> : null}
          {hit.version &&
          hit.version !== 'latest' &&
          hit.version !== 'git' &&
          hit.version !== 'HEAD' ? (
            <span>v{hit.version}</span>
          ) : null}
          {updated ? <span>{t(`Updated ${updated}`, `${updated}更新`)}</span> : null}
        </div>
        <p className="market-community-description">
          {hit.description || t('No description.', '暂无简介。')}
        </p>
      </div>
      <div className="market-card-footer market-community-footer">
        <span className="market-community-stats">
          {hit.monthlyDownloads !== undefined ? (
            <span>
              {t('Monthly downloads', '月下载')} {number.format(hit.monthlyDownloads)}
            </span>
          ) : null}
          {hit.stars !== undefined ? (
            <span>
              {t('Stars', '星标')} {number.format(hit.stars)}
            </span>
          ) : null}
          {hit.installs !== undefined ? (
            <span>
              {t('Installs', '安装量')} {number.format(hit.installs)}
            </span>
          ) : null}
        </span>
        {installState === 'installed' ? (
          <span className="market-status-pill is-installed">{t('Installed', '已安装')}</span>
        ) : (
          <Button
            variant="secondary"
            size="compact"
            data-testid={`${testId}-install`}
            disabled={!installable || installState === 'installing'}
            aria-busy={installState === 'installing'}
            onClick={(event) => {
              event.stopPropagation();
              props.onInstall(hit);
            }}
          >
            {!installable ? (
              t('Source unavailable', '缺少来源')
            ) : installState === 'installing' ? (
              <span className="market-btn-inner market-btn-installing">
                <ProgressRing
                  size={13}
                  strokeWidth={2.2}
                  tone="pine"
                  testId={`${testId}-progress-ring`}
                />
                {t('Installing…', '安装中…')}
              </span>
            ) : installState === 'failed' ? (
              t('Retry…', '重试…')
            ) : (
              t('Install…', '安装…')
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
