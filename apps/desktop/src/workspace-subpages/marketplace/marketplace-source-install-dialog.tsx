/**
 * Advanced install: paste an npm name, GitHub repository or absolute Host
 * directory. Same Host command and risk notice as community installs; the
 * Host re-validates the source.
 */
import { useState, type ReactElement } from 'react';
import type { MarketplacePiPackageSource } from '@piwin/contracts';
import { parsePiPackageSourceInput } from '@piwin/contracts';
import { Button, Dialog, Notice, TextInput } from '@piwin/ui-kit';
import type { DesktopLocale } from '../../desktop-locale.js';

export type MarketplaceSourceInstallDialogProps = {
  open: boolean;
  locale?: DesktopLocale | undefined;
  onInstall: (source: MarketplacePiPackageSource, label: string) => Promise<boolean>;
  onClose: () => void;
};

function sourceKindLabel(source: MarketplacePiPackageSource, zh: boolean): string {
  switch (source.kind) {
    case 'npm':
      return source.version ? `npm · v${source.version}` : zh ? 'npm · 最新版本' : 'npm · latest';
    case 'git':
      return 'GitHub';
    case 'local':
      return zh ? 'Host 本地目录' : 'Host directory';
  }
}

export function MarketplaceSourceInstallDialog(
  props: MarketplaceSourceInstallDialogProps,
): ReactElement | null {
  const zh = props.locale === 'zh-CN';
  const t = (en: string, zhText: string) => (zh ? zhText : en);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  if (!props.open) return null;

  const parsed = parsePiPackageSourceInput(value);
  const close = () => {
    if (busy) return;
    setValue('');
    props.onClose();
  };
  const submit = async () => {
    if (!parsed.ok || busy) return;
    setBusy(true);
    const installed = await props.onInstall(parsed.source, parsed.label);
    setBusy(false);
    if (installed) {
      setValue('');
      props.onClose();
    }
  };

  return (
    <Dialog
      label={t('Install from address', '从地址安装')}
      open={true}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      testId="marketplace-source-install-dialog"
    >
      <form
        className="market-dialog-body"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h3 className="market-dialog-title">{t('Install from address', '从地址安装')}</h3>
        <TextInput
          autoFocus
          value={value}
          onChange={(event) => setValue(event.currentTarget.value)}
          placeholder={t(
            'npm package, GitHub URL, or /absolute/path',
            'npm 包名、GitHub 地址或 /绝对路径',
          )}
          aria-label={t('Package address', '包地址')}
          testId="marketplace-source-input"
        />
        <p className="market-dialog-meta" data-testid="marketplace-source-parsed">
          {parsed.ok
            ? `${sourceKindLabel(parsed.source, zh)} · ${parsed.label}`
            : parsed.reason === 'unrecognized'
              ? t(
                  'Not a recognized npm name, GitHub repository or absolute path.',
                  '无法识别为 npm 包名、GitHub 仓库或绝对路径。',
                )
              : t(
                  'Examples: pi-lens · pi-lens@4.2.1 · github.com/owner/repo',
                  '示例：pi-lens · pi-lens@4.2.1 · github.com/owner/repo',
                )}
        </p>
        <Notice tone="warning">
          {t(
            'Installs a Pi package on this Host. Its code runs with the Host user’s permissions and may run install scripts. Only install sources you trust.',
            '在这台 Host 上安装 Pi 包。其代码以 Host 当前用户权限运行，可能执行安装脚本；只安装你信任的来源。',
          )}
        </Notice>
        <div className="market-dialog-footer">
          <Button variant="ghost" size="compact" onClick={close} disabled={busy}>
            {t('Cancel', '取消')}
          </Button>
          <Button
            variant="primary"
            size="compact"
            // The form handles Enter; a plain button avoids a second submit on click.
            onClick={() => void submit()}
            disabled={!parsed.ok || busy}
            aria-busy={busy}
            data-testid="marketplace-source-install-confirm"
          >
            {busy ? t('Installing…', '安装中…') : t('Install', '安装')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
