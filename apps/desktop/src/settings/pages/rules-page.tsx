/**
 * Settings → Rules page (Wave 1 migration from SettingsPanel).
 * Placeholder until a full rules editor exists.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';

export function RulesPage(): ReactElement {
  const { locale } = useDesktopLocale();

  return (
    <div className="settings-card">
      <div className="settings-section">
        <PageTitle
          title={locale === 'zh-CN' ? '自定义规则' : 'Custom Rules'}
          description={locale === 'zh-CN'
            ? '编辑项目中的 AGENTS.md 以自定义引导 Agent 行为的规则。'
            : 'Edit AGENTS.md in your project to customize rules that guide agent behavior.'}
        />
        <div className="settings-empty-rules muted" data-testid="settings-rules-empty">
          {locale === 'zh-CN' ? '暂无项目规则' : 'No custom rules yet'}
        </div>
        <Button size="compact" disabled>
          {locale === 'zh-CN' ? '新建规则' : 'Create rule'}
        </Button>
      </div>
    </div>
  );
}
