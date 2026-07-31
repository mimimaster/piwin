/**
 * Settings → Usage page (CE-OBS).
 * Renders the token usage panel inside the settings shell, scoped to the
 * current project or global. Reads request + projectPath from useSettings().
 */
import type { ReactElement } from 'react';
import { useDesktopLocale } from '../../desktop-locale-context';
import { UsagePanel } from '../../usage-panel';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

export function UsagePage(): ReactElement {
  const { locale } = useDesktopLocale();
  const { request, projectPath } = useSettings();

  return (
    <div className="settings-card settings-card-flush" data-testid="settings-usage">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={locale === 'zh-CN' ? 'Token 用量统计' : 'Token usage'}
          description={
            locale === 'zh-CN'
              ? '累计输入 / 输出 tokens、按模型、按天与按会话统计。'
              : 'Cumulative input / output tokens, per model, per day, and per session.'
          }
        />
      </div>
      <div className="settings-usage-body">
        <UsagePanel projectPath={projectPath} request={request} />
      </div>
    </div>
  );
}
