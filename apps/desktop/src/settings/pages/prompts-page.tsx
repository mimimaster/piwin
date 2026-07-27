/**
 * Settings → Prompts page (Wave 2 migration from SettingsPanel).
 * Thin wrapper: renders the existing PromptsPanel behind the section registry.
 */
import type { ReactElement } from 'react';
import { PromptsPanel } from '../../PromptsPanel';
import { useSettings } from '../settings-context';

export function PromptsPage(): ReactElement {
  const { projectPath, requestPrompts } = useSettings();

  return (
    <div className="settings-card">
      <PromptsPanel projectPath={projectPath} request={requestPrompts} variant="inline" />
    </div>
  );
}
