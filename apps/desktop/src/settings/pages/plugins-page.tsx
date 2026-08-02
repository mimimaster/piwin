/**
 * Settings → Plugins page. Thin wrapper around PluginsPanel.
 */
import type { ReactElement } from 'react';
import { PluginsPanel } from '../../PluginsPanel';
import { useSettings } from '../settings-context';

export function PluginsPage(): ReactElement {
  const { requestPlugins } = useSettings();

  return (
    <div className="settings-card">
      <PluginsPanel request={requestPlugins} variant="inline" />
    </div>
  );
}
