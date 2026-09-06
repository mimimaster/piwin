/**
 * Settings-facing Host log. Reads the workbench ring-buffer via context so
 * the AppWorkbench setter is not a discarded tuple.
 */
import { useState, type ReactElement } from 'react';
import { HostLogPanel } from '../HostLogPanel';
import { useHostLog } from '../host-log-context';

export function SettingsHostLogSection(): ReactElement | null {
  const log = useHostLog();
  const [open, setOpen] = useState(false);
  if (!log) {
    return null;
  }
  return (
    <div className="settings-section settings-section-card" data-testid="settings-host-log">
      <HostLogPanel
        entries={log.entries}
        onClear={log.onClear}
        open={open}
        onToggle={() => setOpen((current) => !current)}
      />
    </div>
  );
}
