/**
 * Settings → Rules page (Wave 1 migration from SettingsPanel).
 * Placeholder until a full rules editor exists.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';

export function RulesPage(): ReactElement {
  const { locale } = useDesktopLocale();

  return (
    <div className="settings-card">
      <div className="settings-section">
        <h4>{locale === 'zh-CN' ? '规则' : 'Rules'}</h4>
        <p className="muted">
          {locale === 'zh-CN'
            ? '规则用于引导 Agent 行为，兼容 Cursor Rules / AGENTS.md 的工作方式。完整编辑器尚未提供；目前可直接打开项目中的 AGENTS.md。'
            : 'Rules guide agent behavior, similar to Cursor Rules and AGENTS.md. A full editor is not available yet; edit your project AGENTS.md directly for now.'}
        </p>
        <div className="settings-empty-rules muted" data-testid="settings-rules-empty">
          {locale === 'zh-CN' ? '暂无规则' : 'No rules yet'}
        </div>
        <Button disabled>
          {locale === 'zh-CN' ? '新建规则（即将推出）' : 'Create rule (coming soon)'}
        </Button>
      </div>
    </div>
  );
}
