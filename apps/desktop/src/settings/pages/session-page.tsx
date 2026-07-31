/**
 * Settings → Sessions page (Wave 1 migration from SettingsPanel).
 * Auto-compaction default for new sessions.
 */
import type { ReactElement } from 'react';
import type { PiwinConfig } from '@piwin/contracts';
import { Switch } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

export function SessionPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const { config, saveConfig, setInfo } = useSettings();

  async function handleToggleAutoCompact(autoEnabledDefault: boolean): Promise<void> {
    if (!config) return;
    const next: PiwinConfig = {
      ...config,
      compaction: {
        autoEnabledDefault,
        writeTranscriptNote: config.compaction?.writeTranscriptNote === true,
      },
    };
    if (await saveConfig(next)) {
      setInfo(locale === 'zh-CN'
        ? '已保存自动压缩默认值；新会话将继承此设置。'
        : 'Auto-compaction default saved. New sessions will inherit it.');
    }
  }

  return (
    <div className="settings-card">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={locale === 'zh-CN' ? '会话与上下文管理' : 'Sessions & Context'}
          description={locale === 'zh-CN' ? '管理新会话创建时的默认上下文压缩策略与恢复行为。' : 'Configure context compaction strategies and defaults for new sessions.'}
        />
        {config ? (
          <FieldRow
            label={locale === 'zh-CN' ? '自动上下文压缩默认值' : 'Auto-compaction default'}
            description={locale === 'zh-CN' ? '新创建的会话默认开启上下文自动压缩，有助于长会话节省 Token 与加速响应。' : 'Enable context compaction by default for newly spawned sessions to optimize token usage.'}
          >
            <Switch
              checked={config.compaction?.autoEnabledDefault !== false}
              onCheckedChange={(checked) => void handleToggleAutoCompact(checked)}
              aria-label={locale === 'zh-CN' ? '自动上下文压缩' : 'Auto-compaction'}
            />
          </FieldRow>
        ) : null}
      </div>
    </div>
  );
}
