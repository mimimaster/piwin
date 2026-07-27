/**
 * Settings → Memory page (Wave 2 migration from SettingsPanel).
 * Thin wrapper: renders the existing MemoryPanel behind the section registry.
 */
import type { ReactElement } from 'react';
import { MemoryPanel } from '../../MemoryPanel';
import { useSettings } from '../settings-context';

export function MemoryPage(): ReactElement {
  const { projectPath, requestMemory } = useSettings();

  return (
    <div className="settings-card" data-testid="settings-memory">
      <MemoryPanel projectPath={projectPath} request={requestMemory} variant="inline" />
    </div>
  );
}
