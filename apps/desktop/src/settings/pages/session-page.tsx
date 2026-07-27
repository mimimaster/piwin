/**
 * Settings → Sessions page (Wave 1 migration from SettingsPanel).
 * Auto-compaction default for new sessions.
 */
import type { ReactElement } from 'react';
import type { PiwinConfig } from '@piwin/contracts';
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
        <p className="muted">
          {locale === 'zh-CN'
            ? '这是新 SDK/Mock 会话的自动上下文压缩默认值；进行中的会话仍可单独覆盖。'
            : 'This is the auto-compaction default for new SDK and mock sessions. Active sessions can still override it.'}
        </p>
        {config ? (
          <FieldRow
            label={locale === 'zh-CN' ? '自动压缩默认值' : 'Auto-compaction default'}
            description={locale === 'zh-CN' ? '应用于新 SDK/Mock 会话；进行中的会话仍可覆盖。' : 'Applied to new SDK and mock sessions; active sessions can still override it.'}
          >
            <select
              value={config.compaction?.autoEnabledDefault !== false ? 'on' : 'off'}
              onChange={(event) =>
                void handleToggleAutoCompact(event.target.value === 'on')
              }
              data-testid="settings-auto-compact"
            >
              <option value="on">{locale === 'zh-CN' ? '默认开启' : 'On by default'}</option>
              <option value="off">{locale === 'zh-CN' ? '默认关闭' : 'Off by default'}</option>
            </select>
          </FieldRow>
        ) : null}
      </div>
    </div>
  );
}
