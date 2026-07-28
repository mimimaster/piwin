/**
 * Settings → Skills page (Wave 2 migration from SettingsPanel).
 * Rules are merged into Skills as a folded placeholder until a full rules
 * editor exists.
 */
import type { ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { SkillsPanel } from '../../SkillsPanel';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

export function SkillsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { projectPath, requestSkills } = useSettings();

  return (
    <div className="settings-card" data-testid="settings-skills">
      <SkillsPanel projectPath={projectPath} request={requestSkills} variant="inline" />

      <div className="settings-section" data-testid="settings-rules-merged">
        <PageTitle
          title={isChinese ? '自定义规则' : 'Custom Rules'}
          description={isChinese
            ? '编辑项目中的 AGENTS.md 以自定义引导 Agent 行为的规则。'
            : 'Edit AGENTS.md in your project to customize rules that guide agent behavior.'}
        />
        <div className="settings-empty-rules muted" data-testid="settings-rules-empty">
          {isChinese ? '暂无项目规则' : 'No custom rules yet'}
        </div>
        <Button size="compact" disabled>
          {isChinese ? '新建规则' : 'Create rule'}
        </Button>
      </div>
    </div>
  );
}
