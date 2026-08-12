/**
 * Settings → Extensions page (Wave 2 migration from SettingsPanel).
 * Thin wrapper: renders the existing ExtensionsPanel behind the section registry.
 */
import type { ReactElement } from 'react';
import { ExtensionsPanel } from '../../ExtensionsPanel';
import { useSettings } from '../settings-context';

export function ExtensionsPage(): ReactElement {
  const { projectPath, activeSessionId, requestExtensions } = useSettings();

  return (
    <div className="settings-card">
      <ExtensionsPanel
        projectPath={projectPath}
        sessionId={activeSessionId}
        request={requestExtensions}
        variant="inline"
      />
    </div>
  );
}
