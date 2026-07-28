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
      <div className="settings-section">
        <PageTitle
          title={locale === 'zh-CN' ? '会话与上下文' : 'Sessions & context'}
          description={locale === 'zh-CN' ? '配置新会话的上下文行为。' : 'Configure context behavior for new sessions.'}
        />
        {config ? (
          <FieldRow
            label={locale === 'zh-CN' ? '自动上下文压缩' : 'Auto-compaction'}
            description={locale === 'zh-CN' ? '新会话默认开启上下文压缩以节省 Token。' : 'Enable context compaction by default for new sessions to save tokens.'}
          >
            <Switch
              checked={config.compaction?.autoEnabledDefault !== false}
              onChange={() => void handleToggleAutoCompact(config.compaction?.autoEnabledDefault === false)}
            />
          </FieldRow>
        ) : null}
      </div>
    </div>
  );
}
