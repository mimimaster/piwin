/**
 * Settings → Automation page (Wave 2 migration from SettingsPanel).
 * Thin wrapper: renders the existing AutomationPanel behind the section registry.
 */
import type { ReactElement } from 'react';
import { AutomationPanel } from '../../AutomationPanel';
import { useSettings } from '../settings-context';

export function AutomationPage(): ReactElement {
  const { projectPath, requestAutomation } = useSettings();

  return (
    <div className="settings-card">
      <AutomationPanel
        projectPath={projectPath}
        request={requestAutomation}
        variant="inline"
      />
    </div>
  );
}
