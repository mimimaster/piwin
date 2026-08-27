/**
 * Command palette / shortcut dispatch. Shell and Host callbacks stay with
 * App; this table only maps command ids onto those callbacks.
 */
import type { DesktopCommandId } from './desktop-commands';
import type { RightPanelTab } from './right-panel';

export const DESKTOP_COMMAND_OPEN_TAB: Partial<Record<DesktopCommandId, RightPanelTab>> = {
  'open-activity': 'terminal',
  'switch-tab-1': 'files',
  'switch-tab-2': 'terminal',
  'switch-tab-3': 'review',
  'switch-tab-4': 'browser',
  'switch-tab-5': 'docPreview',
};

export type RunDesktopCommandDeps = {
  onNewSession: () => void | Promise<void>;
  onOpenWorkspace: () => void | Promise<void>;
  onStopRun: () => void | Promise<void>;
  openSessionSearch: () => void;
  focusComposer: () => void;
  openSettings: () => void;
  toggleSessions: () => void;
  toggleInspector: (tab?: RightPanelTab | null) => void;
  openInspector: (tab: RightPanelTab) => void;
};

export function runDesktopCommand(commandId: DesktopCommandId, deps: RunDesktopCommandDeps): void {
  switch (commandId) {
    case 'new-session':
      void deps.onNewSession();
      return;
    case 'search-sessions':
      deps.openSessionSearch();
      return;
    case 'focus-composer':
      deps.focusComposer();
      return;
    case 'toggle-inspector':
      deps.toggleInspector('files');
      return;
    case 'open-settings':
      deps.openSettings();
      return;
    case 'open-workspace':
      void deps.onOpenWorkspace();
      return;
    case 'toggle-sidebar':
      deps.toggleSessions();
      return;
    case 'toggle-right-panel':
      deps.toggleInspector(null);
      return;
    case 'stop-run':
      void deps.onStopRun();
      return;
    default: {
      const tab = DESKTOP_COMMAND_OPEN_TAB[commandId];
      if (tab) {
        deps.openInspector(tab);
      }
    }
  }
}
