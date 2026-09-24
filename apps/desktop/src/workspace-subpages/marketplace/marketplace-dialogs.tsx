/**
 * Risk confirmation for installing an unverified live-search Pi package.
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
          <span>{hit.source === 'github' ? 'GitHub' : 'npm'}</span>
          <span>•</span>
          <span>v{hit.version}</span>
          {hit.publisher ? <span>• {hit.publisher}</span> : null}
        </div>
        <Notice tone="warning">
          {t(
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
