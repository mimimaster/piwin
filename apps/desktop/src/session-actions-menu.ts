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

function copyItems(canExport: boolean | undefined, isChinese: boolean): SessionActionItem[] {
  return [
    {
      action: 'copy-id',
      label: isChinese ? '复制 ID' : 'Copy ID',
      testId: 'session-menu-copy-id',
    },
    ...(canExport === false
      ? []
      : [
          {
            action: 'copy-transcript' as const,
            label: isChinese ? '复制转录' : 'Copy Transcript',
            testId: 'session-menu-copy-transcript',
          },
        ]),
  ];
}

export function sessionActionItems(options: {
  isPinned: boolean;
  isArchived: boolean;
  storageState?: 'local' | 'offloaded' | 'missing-pack';
  canExport?: boolean;
  canDuplicate?: boolean;
  canForkChat?: boolean;
  canContinueInProject?: boolean;
  locale?: string;
}): SessionActionItem[] {
  const isChinese = options.locale === 'zh-CN';

  if (options.storageState === 'offloaded' || options.storageState === 'missing-pack') {
    return [
      {
        action: 'restore-pack',
        label: isChinese ? '恢复离线包…' : 'Restore from pack…',
        testId: 'session-menu-restore-pack',
      },
      {
        action: 'rename',
        label: isChinese ? '重命名' : 'Rename',
        testId: 'session-menu-rename',
      },
      {
        action: 'copy-id',
        label: isChinese ? '复制 ID' : 'Copy ID',
        testId: 'session-menu-copy-id',
      },
    ];
  }
  if (options.isArchived) {
    return [
      {
        action: 'unarchive',
        label: isChinese ? '恢复' : 'Restore',
        testId: 'session-menu-unarchive',
      },
      {
        action: 'rename',
        label: isChinese ? '重命名' : 'Rename',
        testId: 'session-menu-rename',
      },
      ...copyItems(options.canExport, isChinese),
      ...(options.canExport === false
        ? []
        : [
            {
              action: 'export' as const,
              label: isChinese ? '导出…' : 'Export…',
              testId: 'session-menu-export',
            },
          ]),
      {
        action: 'delete',
        label: isChinese ? '彻底删除' : 'Delete permanently',
        danger: true,
        testId: 'session-menu-delete',
      },
    ];
  }
  return [
    {
      action: options.isPinned ? 'unpin' : 'pin',
      label: options.isPinned
        ? isChinese ? '取消置顶' : 'Unpin'
        : isChinese ? '置顶' : 'Pin',
      testId: 'session-menu-pin',
    },
    {
      action: 'rename',
      label: isChinese ? '重命名' : 'Rename',
      testId: 'session-menu-rename',
    },
    ...copyItems(options.canExport, isChinese),
    ...(options.canDuplicate === false
      ? []
      : [
          {
            action: 'duplicate' as const,
            label: isChinese ? '复制' : 'Duplicate',
            testId: 'session-menu-duplicate',
          },
        ]),
    ...(options.canForkChat === false
      ? []
      : [
          {
            action: 'fork-chat' as const,
            label: isChinese ? '分叉' : 'Fork Chat',
            testId: 'session-menu-fork-chat',
          },
        ]),
    ...(options.canContinueInProject === false
      ? []
      : [
          {
            action: 'continue-in-project' as const,
            label: isChinese ? '继续到项目…' : 'Continue in project…',
            testId: 'session-menu-continue-in-project',
          },
        ]),
    ...(options.canExport === false
      ? []
      : [
          {
            action: 'export' as const,
            label: isChinese ? '导出…' : 'Export…',
            testId: 'session-menu-export',
          },
        ]),
    {
      action: 'archive',
      label: isChinese ? '归档' : 'Archive',
      testId: 'session-menu-archive',
    },
    {
      action: 'delete',
      label: isChinese ? '删除' : 'Delete',
      danger: true,
      testId: 'session-menu-delete',
    },
  ];
}
