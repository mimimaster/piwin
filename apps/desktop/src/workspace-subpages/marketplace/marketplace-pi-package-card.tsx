import type { ReactElement } from 'react';
import type { MarketplaceSearchHit } from '@piwin/contracts';
import { Button } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { openExternalUrl } from '../../open-external-url.js';

export type MarketplacePiPackageCardProps = {
  hit: MarketplaceSearchHit;
  locale?: DesktopLocale | undefined;
  onCopyInstall: (hit: MarketplaceSearchHit) => void;
};

export function MarketplacePiPackageCard(props: MarketplacePiPackageCardProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const { hit } = props;
  const slug = (hit.source === 'github' ? hit.entryId.replace(/^github:/, '') : hit.name).replace(
    /[@/]/g,
    '-',
  );
  const testId = hit.source === 'github' ? `market-github-${slug}` : `market-npm-${slug}`;
  const sourceLabel = hit.source === 'github' ? 'GitHub' : 'npm';

  return (
    <div className="market-card" data-testid={testId}>
      <div>
        <div className="market-card-top">
          <div className="market-card-identity">
            <div className="market-card-header-texts">
              <div className="market-card-title-row">
                <strong className="market-card-title">{hit.name}</strong>
                <span className={`market-source-pill is-${hit.source === 'github' ? 'git' : 'npm'}`}>
                  {sourceLabel}
                </span>
                <span
                  className="market-tier-badge is-unverified"
                  title={
                    hit.source === 'github'
                      ? t(
                          'GitHub repo tagged topic:pi-package. Not verified in the piwin desktop shell.',
                          'GitHub 上带 topic:pi-package 的仓库。尚未在 piwin 桌面端实测。',
                        )
                      : t(
                          'Listed on the Pi npm catalog. Not verified to run in the piwin desktop shell.',
                          '来自 Pi 的 npm 目录。尚未在 piwin 桌面端实测。',
                        )
                  }
                >
                  {t('Unverified', '未实测')}
                </span>
              </div>
              <span className="market-card-meta">
                {hit.entryId} • v{hit.version}
                {hit.publisher ? ` • ${hit.publisher}` : ''}
              </span>
            </div>
          </div>
        </div>

        <p className="market-card-desc">
          {hit.description || t('No description.', '暂无简介。')}
        </p>

        <div className="market-card-tags">
          <span className="market-code-tag">{hit.installCommand}</span>
        </div>
      </div>

      <div className="market-card-footer">
        <span className="market-card-source">
          {hit.source === 'github'
            ? t('Pi catalog · GitHub', 'Pi 生态 · GitHub')
            : t('Pi catalog · npm', 'Pi 生态 · npm')}
        </span>
        <div className="market-card-actions">
          {hit.repositoryUrl ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                void openExternalUrl(hit.repositoryUrl ?? '');
              }}
            >
              GitHub
            </Button>
          ) : null}
          {hit.npmUrl ? (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => {
                void openExternalUrl(hit.npmUrl ?? '');
              }}
            >
              npm
            </Button>
          ) : null}
          <Button variant="primary" size="compact" onClick={() => props.onCopyInstall(hit)}>
            {t('Copy install command', '复制安装命令')}
          </Button>
        </div>
      </div>
    </div>
  );
}
