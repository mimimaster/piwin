/**
 * Settings → Skills page (Wave 2 migration from SettingsPanel).
 * Thin wrapper: renders the existing SkillsPanel behind the section registry.
 */
import type { ReactElement } from 'react';
import { SkillsPanel } from '../../SkillsPanel';
import { useSettings } from '../settings-context';

export function SkillsPage(): ReactElement {
  const { projectPath, requestSkills } = useSettings();

  return (
    <div className="settings-card" data-testid="settings-skills">
      <SkillsPanel projectPath={projectPath} request={requestSkills} variant="inline" />
    </div>
  );
}
