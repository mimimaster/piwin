import { useState, type ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';

import type { DesktopLocale } from './desktop-locale';
import { openExternalUrl } from './open-external-url.js';
import { GIT_FOR_WINDOWS_DOWNLOAD_URL } from './windows-shell-offer.js';

export function WindowsShellOfferBanner(props: {
  visible: boolean;
  locale: DesktopLocale;
  onUseGitBash: () => void;
  onDecline: () => void;
}): ReactElement | null {
  const [downloaded, setDownloaded] = useState(false);
  if (!props.visible) return null;
  const zh = props.locale === 'zh-CN';
  return (
    <Notice
      tone="info"
      testId="windows-shell-offer"
      action={
        <>
          <Button
            variant="primary"
            data-testid="windows-shell-install"
            onClick={() => {
              void openExternalUrl(GIT_FOR_WINDOWS_DOWNLOAD_URL).then((opened) => {
                if (opened) setDownloaded(true);
              });
            }}
          >
            {zh ? '下载 Git Bash' : 'Download Git Bash'}
          </Button>
          {downloaded ? (
            <Button data-testid="windows-shell-confirm" onClick={props.onUseGitBash}>
              {zh ? '我已安装' : 'I installed it'}
            </Button>
          ) : null}
          <Button data-testid="windows-shell-powershell" onClick={props.onDecline}>
            {zh ? '不用，走 PowerShell' : 'No, use PowerShell'}
          </Button>
        </>
      }
    >
      {zh
        ? '这台机器上没有 Git Bash，命令目前按 PowerShell 执行。装上后点一下确认，会自动改用它。'
        : 'No Git Bash on this machine, so commands run as PowerShell. Install it and confirm — piwin picks it up automatically.'}
    </Notice>
  );
}
