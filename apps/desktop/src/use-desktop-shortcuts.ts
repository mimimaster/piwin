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

      if (key === 'k') {
        event.preventDefault();
        options.onOpenPalette();
        return;
      }

      // Do not fire action shortcuts while typing, except palette above.
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
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [options]);
}
