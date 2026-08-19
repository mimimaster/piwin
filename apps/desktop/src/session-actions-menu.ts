/**
 * Shared session action catalog for dropdown + context menus.
 */
import type { SessionRowMenuAction } from './session-row-menu';

export type SessionActionItem = {
  action: SessionRowMenuAction;
  label: string;
  danger?: boolean;
  testId: string;
};

export function sessionActionItems(options: {
  isPinned: boolean;
  isArchived: boolean;
  storageState?: 'local' | 'offloaded' | 'missing-pack';
}): SessionActionItem[] {
  if (options.storageState === 'offloaded' || options.storageState === 'missing-pack') {
    return [
      { action: 'restore-pack', label: 'Restore from pack…', testId: 'session-menu-restore-pack' },
      { action: 'rename', label: 'Rename', testId: 'session-menu-rename' },
      { action: 'copy-id', label: 'Copy ID', testId: 'session-menu-copy-id' },
    ];
  }
  if (options.isArchived) {
    return [
      { action: 'unarchive', label: 'Restore', testId: 'session-menu-unarchive' },
      { action: 'rename', label: 'Rename', testId: 'session-menu-rename' },
      { action: 'copy-id', label: 'Copy ID', testId: 'session-menu-copy-id' },
      { action: 'export', label: 'Export…', testId: 'session-menu-export' },
      {
        action: 'delete',
        label: 'Delete permanently',
        danger: true,
        testId: 'session-menu-delete',
      },
    ];
  }
  return [
    {
      action: options.isPinned ? 'unpin' : 'pin',
      label: options.isPinned ? 'Unpin' : 'Pin',
      testId: 'session-menu-pin',
    },
    { action: 'rename', label: 'Rename', testId: 'session-menu-rename' },
    { action: 'copy-id', label: 'Copy ID', testId: 'session-menu-copy-id' },
    { action: 'duplicate', label: 'Duplicate', testId: 'session-menu-duplicate' },
    {
      action: 'continue-in-project',
      label: 'Continue in project…',
      testId: 'session-menu-continue-in-project',
    },
    { action: 'export', label: 'Export…', testId: 'session-menu-export' },
    { action: 'archive', label: 'Archive', testId: 'session-menu-archive' },
    {
      action: 'delete',
      label: 'Delete',
      danger: true,
      testId: 'session-menu-delete',
    },
  ];
}
