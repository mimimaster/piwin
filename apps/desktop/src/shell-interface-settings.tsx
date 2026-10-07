/**
 * Settings → General card that returns the mobile shell to its classic
 * phone interface. Rendered only inside the mobile shell: a browser tab and
 * the Desktop app have a single interface.
 */
import type { ReactElement } from 'react';
import { switchShellInterface } from '@piwin/host-client';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context.js';
import { PageTitle } from './settings/page-title.js';
import { isMobileTauriRuntime } from './shell-runtime.js';

const COPY = {
  'zh-CN': {
    title: '界面模式',
    description:
      '当前为默认界面，与桌面端和网页端是同一套。经典界面是早期的手机专用界面，已停止新增功能。',
    switchToClassic: '切换到经典界面',
  },
  en: {
    title: 'Interface',
    description:
      'This is the default interface, the same one Desktop and the web use. Classic is the earlier phone-only interface; it no longer receives new features.',
    switchToClassic: 'Switch to classic',
  },
} as const;

export function ShellInterfaceSettings(): ReactElement | null {
  const { locale } = useDesktopLocale();
  if (!isMobileTauriRuntime()) {
    return null;
  }
  const copy = COPY[locale];
  return (
    <div
      className="settings-section settings-section-card"
      data-testid="shell-interface-settings"
    >
      <PageTitle title={copy.title} description={copy.description} />
      <div className="host-target-actions">
        <Button
          variant="secondary"
          onClick={() => switchShellInterface('classic', window)}
          data-testid="shell-interface-switch-classic"
        >
          {copy.switchToClassic}
        </Button>
      </div>
    </div>
  );
}
