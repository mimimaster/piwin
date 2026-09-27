/**
 * Risk confirmation for installing a live-search hit (registry, npm, GitHub).
 */
import type { ReactElement } from 'react';
import type { MarketplaceSearchHit } from '@piwin/contracts';
import { Button, Dialog, Notice } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';

export type PiPackageInstallDialogProps = {
  hit: MarketplaceSearchHit | null;
  locale?: DesktopLocale | undefined;
  onConfirm: (hit: MarketplaceSearchHit) => void;
  onCancel: () => void;
};

export function PiPackageInstallDialog({
  hit,
  locale,
  onConfirm,
  onCancel,
}: PiPackageInstallDialogProps): ReactElement | null {
  const isZh = locale === 'zh-CN';
  const t = (en: string, zh: string) => (isZh ? zh : en);
  if (!hit) return null;

  return (
    <Dialog
      label={t('Confirm community package installation', '确认安装社区扩展')}
      open={true}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      testId="marketplace-package-install-dialog"
    >
      <div className="market-dialog-body">
        <h3 className="market-dialog-title">
          {t(`Install ${hit.name}`, `安装 ${hit.name}`)}
        </h3>
        <div className="market-dialog-meta">
          <span>{hit.registry ? hit.registry.id : hit.source === 'github' ? 'GitHub' : 'npm'}</span>
          <span>•</span>
          <span>v{hit.version}</span>
          {hit.publisher ? <span>• {hit.publisher}</span> : null}
          {hit.registry ? <span>• {hit.registry.commit.slice(0, 12)}</span> : null}
        </div>
        {hit.registry?.forkOf ? (
          <p className="market-dialog-meta">
            {t(
              `Modified copy of ${hit.registry.forkOf.id} ${hit.registry.forkOf.version}. Compare it with the original before installing.`,
              `这是 ${hit.registry.forkOf.id} ${hit.registry.forkOf.version} 的改装版，安装前建议先对比原版源码。`,
            )}
          </p>
        ) : null}
        <Notice tone="warning">
          {hit.registry
            ? t(
                'This extension comes from the community registry. piwin stages the pinned commit without running npm or install scripts, then enables it; once enabled it runs with the Host user’s OS permissions. Review its source before continuing.',
                '该扩展来自社区扩展仓库。piwin 只拉取固定 commit，不执行 npm 或安装脚本，安装后会直接启用；启用后它以 Host 当前用户的系统权限运行。继续前请确认你信任其源码。',
              )
            : t(
                'This is an unverified community package. Installation may download dependencies and run install scripts with the Host user’s permissions. Review its source before continuing.',
                '这是未经 piwin 实测的社区扩展。安装过程可能下载依赖，并以 Host 当前用户权限运行安装脚本；继续前请确认你信任其源码。',
              )}
        </Notice>
        <div className="market-dialog-footer">
          <Button variant="ghost" size="compact" onClick={onCancel}>
            {t('Cancel', '取消')}
          </Button>
          <Button variant="primary" size="compact" onClick={() => onConfirm(hit)}>
            {t('Install package', '确认安装')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
