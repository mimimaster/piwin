/**
 * Global keyboard shortcuts for the desktop shell.
 */
import { useEffect } from 'react';
import type { DesktopCommandId } from './desktop-commands';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return target.isContentEditable;
}

export function useDesktopShortcuts(options: {
  enabled?: boolean;
  onCommand: (commandId: DesktopCommandId) => void;
  onOpenPalette: () => void;
}): void {
  useEffect(() => {
    if (options.enabled === false) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) {
        return;
      }
      const key = event.key.toLowerCase();
      const editable = isEditableTarget(event.target);

      // Always-available shortcuts (work even while typing in text fields).
      if (key === 'k') {
        event.preventDefault();
        options.onOpenPalette();
        return;
      }
      if (key === '.') {
        event.preventDefault();
        options.onCommand('stop-run');
        return;
      }

      // Do not fire action shortcuts while typing, except palette and stop above.
      if (editable) {
        return;
      }

      if (key === 'n' && !event.shiftKey) {
        event.preventDefault();
        options.onCommand('new-session');
        return;
      }
      if (key === 'f' && event.shiftKey) {
        event.preventDefault();
        options.onCommand('search-sessions');
        return;
      }
      if (key === 'l' && !event.shiftKey) {
        event.preventDefault();
        options.onCommand('focus-composer');
        return;
      }
      if (key === 'i' && event.shiftKey) {
        event.preventDefault();
        options.onCommand('toggle-inspector');
        return;
      }
      if (key === 'j' && !event.shiftKey) {
        event.preventDefault();
        options.onCommand('open-activity');
        return;
      }
      if (key === 'b' && !event.shiftKey) {
        event.preventDefault();
        options.onCommand('toggle-sidebar');
        return;
      }
      if (key === '\\') {
        event.preventDefault();
        options.onCommand('toggle-right-panel');
        return;
      }
      if (key === ',' && !event.shiftKey) {
        event.preventDefault();
        options.onCommand('open-settings');
        return;
      }
      if (key === 'o' && !event.shiftKey) {
        event.preventDefault();
        options.onCommand('open-workspace');
        return;
      }

      // Tab switching (⌘1-5)
      const digit = parseInt(key, 10);
      if (digit >= 1 && digit <= 5) {
        event.preventDefault();
        const tabCommands: DesktopCommandId[] = [
          'switch-tab-1',
          'switch-tab-2',
          'switch-tab-3',
          'switch-tab-4',
          'switch-tab-5',
        ];
        options.onCommand(tabCommands[digit - 1]!);
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [options]);
}
