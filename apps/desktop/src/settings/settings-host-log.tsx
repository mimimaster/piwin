/**
 * Settings-facing Host log. Reads the workbench ring-buffer via context so
 * the AppWorkbench setter is not a discarded tuple.
 */
import type { ReactElement } from 'react';
import { StatusBadge } from '@piwin/ui-kit';
import { HostLogPanel } from '../HostLogPanel';
import { useDesktopLocale } from '../desktop-locale-context.js';
import { useHostLog } from '../host-log-context';
import { PageTitle } from './page-title';

export function SettingsHostLogSection(): ReactElement | null {
  const log = useHostLog();
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  if (!log) {
    return null;
  }

  const errorCount = log.entries.filter((entry) => entry.level === 'error').length;
  const warnCount = log.entries.filter((entry) => entry.level === 'warn').length;
  const badgeTone = errorCount > 0 ? 'danger' : warnCount > 0 ? 'warning' : 'neutral';

  return (
    <div className="settings-section settings-section-card" data-testid="settings-host-log">
      <PageTitle
        title={isZh ? 'Host 日志' : 'Host log'}
        description={
          isZh
            ? 'Host 诊断输出。MCP、权限与运行时警告会出现在这里。'
            : 'Diagnostic output from the Host. MCP, permission, and runtime warnings land here.'
        }
        trailing={
          <StatusBadge
            tone={badgeTone}
            label={isZh ? `${log.entries.length} 条` : String(log.entries.length)}
            testId="settings-host-log-count"
          />
        }
      />
      <HostLogPanel entries={log.entries} onClear={log.onClear} />
    </div>
  );
}
