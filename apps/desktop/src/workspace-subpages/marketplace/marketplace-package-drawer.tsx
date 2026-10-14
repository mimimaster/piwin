/**
 * Detail drawer for one unreviewed community result: README, license, last
 * update, source link and install command. Install still goes through the
 * risk confirmation dialog; this drawer never installs on its own.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type {
  HostCommand,
  HostResponse,
  MarketplacePackageDetailData,
  MarketplaceSearchHit,
} from '@piwin/contracts';
import { Button, Dialog, IconButton, Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';
import { MarkdownView } from '../../MarkdownView.js';
import { openExternalUrl } from '../../open-external-url.js';
import { IconCheck, IconClose, IconCopy, IconExternalLink } from '../../shell-icons.js';
import { isPackageInstallable } from './marketplace-pi-package-card.js';
import {
  formatRelativeDate,
  packageSourceLabel,
  packageSourceUrl,
  sanitizeReadme,
} from './marketplace-package-meta.js';
import type { MarketplaceToast } from './marketplace-types.js';
import type { MarketplacePackageInstallState } from './use-marketplace-package-install.js';

export type MarketplacePackageDrawerProps = {
  hit: MarketplaceSearchHit | null;
  installState: MarketplacePackageInstallState | 'idle';
  locale?: DesktopLocale | undefined;
  request: (command: HostCommand) => Promise<HostResponse>;
  onInstall: (hit: MarketplaceSearchHit) => void;
  showToast: (toast: MarketplaceToast) => void;
  onClose: () => void;
};

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; detail: MarketplacePackageDetailData }
  | { status: 'error'; message: string };

function useHitDetail(
  hit: MarketplaceSearchHit | null,
  request: MarketplacePackageDrawerProps['request'],
): DetailState | null {
  const [state, setState] = useState<DetailState | null>(null);
  // Parents pass a fresh closure each render; only a new hit should refetch.
  const requestRef = useRef(request);
  requestRef.current = request;
  useEffect(() => {
    if (!hit || (hit.source !== 'npm-pi-package' && !hit.repositoryUrl)) {
      setState(null);
      return undefined;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void requestRef
      .current({
        type: 'marketplace/package-detail',
        entryId: hit.entryId,
        ...(hit.source === 'npm-pi-package' ? { npmPackageName: hit.name } : {}),
        ...(hit.repositoryUrl ? { repositoryUrl: hit.repositoryUrl } : {}),
      })
      .then(
        (response) => {
          if (cancelled) return;
          setState(
            response.success
              ? { status: 'ready', detail: response.data as MarketplacePackageDetailData }
              : { status: 'error', message: response.error },
          );
        },
        (error: unknown) => {
          if (!cancelled)
            setState({
              status: 'error',
              message: error instanceof Error ? error.message : String(error),
            });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [hit]);
  return state;
}

export function MarketplacePackageDrawer(
  props: MarketplacePackageDrawerProps,
): ReactElement | null {
  const { hit, locale } = props;
  const zh = locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  const detailState = useHitDetail(hit, props.request);
  const [copied, setCopied] = useState(false);
  if (!hit) return null;

  const detail = detailState?.status === 'ready' ? detailState.detail : undefined;
  const sourceUrl = packageSourceUrl(hit);
  const updatedAt = detail?.updatedAt ?? hit.updatedAt;
  const updated = updatedAt ? formatRelativeDate(updatedAt, locale) : undefined;
  const readme = detail?.readme ? sanitizeReadme(detail.readme) : '';
  const installable = isPackageInstallable(hit);

  const copyCommand = () => {
    void navigator.clipboard.writeText(hit.installCommand).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      },
      () =>
        props.showToast({
          type: 'error',
          title: t('Copy failed', '复制失败'),
          text: hit.installCommand,
        }),
    );
  };

  return (
    <Dialog
      label={hit.name}
      open={true}
      closeOnInteractOutside={true}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      testId="marketplace-package-drawer"
      contentClassName="market-entry-modal market-drawer"
    >
      <div className="market-entry">
        <header className="market-entry-head market-entry-head-plain">
          <div className="market-entry-heading">
            <h3 className="market-entry-title">{hit.name}</h3>
            <p className="market-entry-kicker">
              {packageSourceLabel(hit)}
              {hit.publisher ? ` · ${hit.publisher}` : ''}
              <span className="market-community-unverified">{t('Unreviewed', '未审核')}</span>
            </p>
          </div>
          <IconButton
            label={t('Close', '关闭')}
            size="sm"
            className="market-entry-close"
            onClick={props.onClose}
          >
            <IconClose width={14} height={14} aria-hidden="true" />
          </IconButton>
        </header>

        <div className="market-entry-scroll">
          {hit.description ? <p className="market-entry-desc">{hit.description}</p> : null}

          <dl className="market-entry-ledger">
            <div>
              <dt>{t('Version', '版本')}</dt>
              <dd title={hit.version}>{hit.version}</dd>
            </div>
            <div>
              <dt>{t('License', '许可证')}</dt>
              <dd>{detail?.license ?? '—'}</dd>
            </div>
            <div>
              <dt>{t('Updated', '更新')}</dt>
              <dd>{updated ?? '—'}</dd>
            </div>
            <div>
              <dt>{hit.stars !== undefined ? t('Stars', '星标') : t('Monthly', '月下载')}</dt>
              <dd>{Intl.NumberFormat(locale).format(hit.stars ?? hit.monthlyDownloads ?? 0)}</dd>
            </div>
          </dl>

          <button
            type="button"
            className="market-cmd-bar"
            onClick={copyCommand}
            title={t('Copy install command', '复制安装命令')}
          >
            <span className="market-cmd-prefix">$</span>
            <span className="market-cmd-text">{hit.installCommand}</span>
            <span className="market-cmd-action" aria-hidden="true">
              {copied ? <IconCheck width={13} height={13} /> : <IconCopy width={13} height={13} />}
            </span>
          </button>

          {detailState?.status === 'loading' ? (
            <p className="market-entry-note" data-testid="marketplace-package-readme-loading">
              {t('Reading README…', '正在读取 README…')}
            </p>
          ) : null}
          {readme ? (
            <section className="market-entry-section">
              <h4 className="market-entry-section-title">README</h4>
              <div className="market-readme" data-testid="marketplace-package-readme">
                <MarkdownView
                  text={readme}
                  artifactInlineEnabled={false}
                  artifactCanvasEnabled={false}
                  renderingPhase="completed"
                />
              </div>
            </section>
          ) : null}
          {detailState?.status === 'error' || detail?.remoteError ? (
            <p className="market-entry-note">
              {t('Some details could not be read: ', '部分信息读取失败：')}
              {detailState?.status === 'error' ? detailState.message : detail?.remoteError}
            </p>
          ) : null}

          <div className="market-entry-status">
            <Notice tone="warning">
              {t(
                'Unreviewed community code. Installing may download dependencies and run scripts with the Host user’s permissions.',
                '未经审核的社区代码。安装可能下载依赖，并以 Host 当前用户权限运行脚本。',
              )}
            </Notice>
          </div>
        </div>

        <footer className="market-entry-foot">
          {sourceUrl ? (
            <Button
              variant="ghost"
              size="compact"
              className="market-entry-source"
              onClick={() => void openExternalUrl(sourceUrl)}
            >
              <span className="market-btn-inner">
                <IconExternalLink width={12} height={12} aria-hidden="true" />
                {packageSourceLabel(hit)}
              </span>
            </Button>
          ) : null}
          {props.installState === 'installed' ? (
            <span className="market-status-pill is-installed">{t('Installed', '已安装')}</span>
          ) : (
            <Button
              variant="primary"
              size="compact"
              disabled={!installable || props.installState === 'installing'}
              aria-busy={props.installState === 'installing'}
              onClick={() => props.onInstall(hit)}
              data-testid="marketplace-package-drawer-install"
            >
              {props.installState === 'installing'
                ? t('Installing…', '安装中…')
                : !installable
                  ? t('Source unavailable', '缺少来源')
                  : t('Install…', '安装…')}
            </Button>
          )}
        </footer>
      </div>
    </Dialog>
  );
}
