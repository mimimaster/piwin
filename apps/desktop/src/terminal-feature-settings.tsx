import type { ReactElement } from 'react';
import { Switch } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context.js';
import { isDesktopTauriRuntime } from './shell-runtime.js';
import { isTerminalFeatureEnabled } from './terminal-feature.js';
import { FieldRow } from './settings/field-row.js';
import { PageTitle } from './settings/page-title.js';
import { useSettings } from './settings/settings-context.js';

export function TerminalFeatureSettings(): ReactElement | null {
  const { locale } = useDesktopLocale();
  const { preferences, onPreferencesChange } = useSettings();
  if (!isDesktopTauriRuntime()) return null;
  const chinese = locale === 'zh-CN';
  const label = chinese ? '启用终端功能' : 'Enable terminals';
  return (
    <div className="settings-section settings-section-card" data-testid="terminal-feature-settings">
      <PageTitle title={chinese ? '终端' : 'Terminal'} />
      <FieldRow
        label={label}
        description={chinese
          ? '开启顶部 CLI 界面切换和侧栏终端。正式环境默认关闭，开发与测试环境默认开启。'
          : 'Show the titlebar CLI switch and side-panel terminal. Off by default in production; on in development and tests.'}
      >
        <Switch
          checked={isTerminalFeatureEnabled(preferences.terminalEnabled)}
          onCheckedChange={(terminalEnabled) => onPreferencesChange({ ...preferences, terminalEnabled })}
          aria-label={label}
          testId="terminal-feature-switch"
        />
      </FieldRow>
    </div>
  );
}
