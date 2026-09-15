/**
 * Settings → Usage page (CE-OBS).
 * Renders the token usage panel inside the settings shell, scoped to the
 * current project or global. Reads request + projectPath from useSettings().
 */
import type { ReactElement } from 'react';
import { UsagePanel } from '../../usage-panel';
import { useSettings } from '../settings-context';

export function UsagePage(): ReactElement {
  const { request, projectPath } = useSettings();

  return (
    <div className="settings-usage-page" data-testid="settings-usage">
      <UsagePanel projectPath={projectPath} request={request} />
    </div>
  );
}
