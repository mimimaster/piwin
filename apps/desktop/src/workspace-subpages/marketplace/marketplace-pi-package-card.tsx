import { useState, type ReactElement } from 'react';
import type { MarketplaceSearchHit } from '@piwin/contracts';
import { Button, ProgressBar, ProgressRing } from '@piwin/ui-kit';
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

  const presentation = describeHitSource(hit, t);
  const installState = props.installState ?? 'idle';

  const handleCopy = () => {
    props.onCopyInstall(hit);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };


  return (
    <div className={`market-card market-ecosystem-card${copied ? ' is-recently-copied' : ''}`} data-testid={presentation.testId}>
      <div className="market-card-content">
        <div className="market-card-top">
          <div className="market-card-identity">
            <div className="market-card-header-texts">
              <div className="market-card-title-row">
                <strong className="market-card-title" title={hit.name}>
                  {hit.name}
                </strong>
                <span className={`market-source-pill is-${presentation.pillTone}`}>
                  {presentation.sourceLabel}
                </span>
                <span className="market-tier-badge is-unverified" title={presentation.badgeTitle}>
                  {presentation.badgeLabel}
                </span>
              </div>
              <span className="market-card-meta">{presentation.meta}</span>
              {hit.registry?.forkOf ? (
                <span className="market-card-meta" data-testid={`${presentation.testId}-fork`}>
                  {t(
                    `Modified from ${hit.registry.forkOf.id} ${hit.registry.forkOf.version}`,
                    `基于 ${hit.registry.forkOf.id} ${hit.registry.forkOf.version} 改装`,
                  )}
                </span>
              ) : null}
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

      {installState === 'installing' ? (
        <ProgressBar label={t('Installing…', '安装中…')} className="market-card-progress" testId={`${presentation.testId}-progress`} />
      ) : null}

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
            data-testid={`${presentation.testId}-install`}
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
                <ProgressRing size={13} strokeWidth={2.2} tone="pine" testId={`${presentation.testId}-progress-ring`} />
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

type HitSourcePresentation = {
  testId: string;
  sourceLabel: string;
  pillTone: 'registry' | 'git' | 'npm';
  badgeLabel: string;
  badgeTitle: string;
  meta: string;
};

function describeHitSource(
  hit: MarketplaceSearchHit,
  t: (en: string, zh: string) => string,
): HitSourcePresentation {
  if (hit.source === 'piwin-registry' && hit.registry) {
    const owners = hit.registry.owners.join(', ');
    return {
      testId: `market-registry-${hit.registry.id.replace(/[@/]/g, '-')}`,
      sourceLabel: t('Registry', '扩展仓库'),
      pillTone: 'registry',
      badgeLabel: t('Community', '社区'),
      badgeTitle: t(
        'Listed in the piwin extension registry: structural CI checks and a maintainer merge, not a security review.',
        '收录于 piwin 扩展仓库：通过了结构检查并经维护者合并，但不等于安全审查。',
      ),
      meta: `${hit.registry.id} • v${hit.version} • ${hit.registry.license} • ${owners} • ${hit.registry.commit.slice(0, 7)}`,
    };
  }
  if (hit.source === 'github') {
    return {
      testId: `market-github-${hit.entryId.replace(/^github:/, '').replace(/[@/]/g, '-')}`,
      sourceLabel: 'GitHub',
      pillTone: 'git',
      badgeLabel: t('Unverified', '未实测'),
      badgeTitle: t(
        'GitHub repo tagged topic:pi-package. Community package.',
        'GitHub 上带 topic:pi-package 的仓库。社区开源生态。',
      ),
      meta: `${hit.entryId} • v${hit.version}`,
    };
  }
  return {
    testId: `market-npm-${hit.name.replace(/[@/]/g, '-')}`,
    sourceLabel: 'npm',
    pillTone: 'npm',
    badgeLabel: t('Unverified', '未实测'),
    badgeTitle: t('Listed on the Pi npm catalog. Community package.', '来自 Pi 的 npm 目录。社区开源生态。'),
    meta: `v${hit.version}${hit.publisher ? ` • ${hit.publisher}` : ''}`,
  };
}
