import { useState, type ReactElement } from 'react';
import type { MarketplaceSearchHit } from '@piwin/contracts';
import { Button, ProgressRing } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { openExternalUrl } from '../../open-external-url.js';
import { IconCheck, IconCopy, IconGit } from '../../shell-icons.js';

export type MarketplacePiPackageCardProps = {
  hit: MarketplaceSearchHit;
  locale?: DesktopLocale | undefined;
  onCopyInstall: (hit: MarketplaceSearchHit) => void;
  onInstall: (hit: MarketplaceSearchHit) => void;
  installState?: 'idle' | 'installing' | 'installed' | 'failed' | undefined;
};

export function MarketplacePiPackageCard(props: MarketplacePiPackageCardProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  const { hit } = props;
  const [copied, setCopied] = useState(false);

  const slug = (hit.source === 'github' ? hit.entryId.replace(/^github:/, '') : hit.name).replace(
    /[@/]/g,
    '-',
  );
  const testId = hit.source === 'github' ? `market-github-${slug}` : `market-npm-${slug}`;
  const sourceLabel = hit.source === 'github' ? 'GitHub' : 'npm';
  const installState = props.installState ?? 'idle';

  const handleCopy = () => {
    props.onCopyInstall(hit);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const metaText =
    hit.source === 'github'
      ? `${hit.entryId} • v${hit.version}`
      : `v${hit.version}${hit.publisher ? ` • ${hit.publisher}` : ''}`;

  return (
    <div className={`market-card market-ecosystem-card${copied ? ' is-recently-copied' : ''}`} data-testid={testId}>
      <div className="market-card-content">
        <div className="market-card-top">
          <div className="market-card-identity">
            <div className="market-card-header-texts">
              <div className="market-card-title-row">
                <strong className="market-card-title" title={hit.name}>
                  {hit.name}
                </strong>
                <span className={`market-source-pill is-${hit.source === 'github' ? 'git' : 'npm'}`}>
                  {sourceLabel}
                </span>
                <span
                  className="market-tier-badge is-unverified"
                  title={
                    hit.source === 'github'
                      ? t(
                          'GitHub repo tagged topic:pi-package. Community package.',
                          'GitHub 上带 topic:pi-package 的仓库。社区开源生态。',
                        )
                      : t(
                          'Listed on the Pi npm catalog. Community package.',
                          '来自 Pi 的 npm 目录。社区开源生态。',
                        )
                  }
                >
                  {t('Unverified', '未实测')}
                </span>
              </div>
              <span className="market-card-meta">{metaText}</span>
            </div>
          </div>
        </div>

        <p className="market-card-desc">
          {hit.description || t('No description.', '暂无简介。')}
        </p>

        <button
          type="button"
          className={`market-cmd-bar${copied ? ' is-copied' : ''}`}
          onClick={handleCopy}
          title={t('Click to copy install command', '点击复制安装命令')}
          aria-label={t('Click to copy install command', '点击复制安装命令')}
        >
          <span className="market-cmd-prefix" aria-hidden="true">$</span>
          <code className="market-cmd-text">{hit.installCommand}</code>
          <span className="market-cmd-action" aria-hidden="true">
            {copied ? (
              <span className="market-cmd-copied-indicator">
                <IconCheck width={12} height={12} />
                <span>{t('Copied', '已复制')}</span>
              </span>
            ) : (
              <IconCopy width={12} height={12} />
            )}
          </span>
        </button>
      </div>

      <div className="market-card-footer">
        <div className="market-card-links">
          {hit.repositoryUrl ? (
            <button
              type="button"
              className="market-link-btn"
              onClick={() => void openExternalUrl(hit.repositoryUrl ?? '')}
              title={t('Open repository', '打开代码仓库')}
            >
              <IconGit width={12} height={12} aria-hidden="true" />
              <span>GitHub</span>
            </button>
          ) : null}
          {hit.npmUrl ? (
            <button
              type="button"
              className="market-link-btn"
              onClick={() => void openExternalUrl(hit.npmUrl ?? '')}
              title={t('Open npm package page', '打开 npm 页面')}
            >
              <span>npm</span>
            </button>
          ) : null}
        </div>

        <div className="market-card-actions">
          <Button
            variant={installState === 'installed' ? 'secondary' : 'primary'}
            size="compact"
            data-testid={`${testId}-install`}
            disabled={installState === 'installing' || installState === 'installed'}
            aria-busy={installState === 'installing'}
            onClick={() => props.onInstall(hit)}
          >
            {installState === 'installed' ? (
              <span className="market-btn-inner">
                <IconCheck width={12} height={12} aria-hidden="true" />
                <span>{t('Installed', '已安装')}</span>
              </span>
            ) : installState === 'installing' ? (
              <span className="market-btn-inner market-btn-installing">
                {/* Pi reports no byte progress; an honest spinner beats a fake percentage. */}
                <ProgressRing size={13} strokeWidth={2.2} tone="pine" testId={`${testId}-progress-ring`} />
                <span className="market-btn-progress-label">{t('Installing…', '安装中…')}</span>
              </span>
            ) : installState === 'failed' ? (
              t('Retry install', '重试安装')
            ) : (
              t('Install', '安装')
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
