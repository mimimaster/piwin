/**
 * Pure context-menu catalog factory (CM §5 / §9.2).
 * No React — unit-tested for order and capability gates.
 */
import type {
  ContextMenuActionId,
  ContextMenuCapabilities,
  ContextMenuItemSpec,
  ContextMenuTarget,
} from './types.js';

type LabelTable = Record<ContextMenuActionId, string>;

const EN_LABELS: LabelTable = {
  'generate-flashcard': 'Generate flashcard',
  'add-to-chat': 'Add to Chat',
  'ask-about': 'Ask about…',
  'copy-as-ref': 'Copy as @ref',
  explain: 'Explain',
  fix: 'Fix / Improve',
  review: 'Review',
  tests: 'Generate tests',
  'explain-failure': 'Explain failure',
  'fix-error': 'Fix this error',
  open: 'Open',
  reveal: 'Show in Folder',
  'save-as': 'Save As…',
  copy: 'Copy',
  'copy-image': 'Copy Image',
  'copy-relative-path': 'Copy Relative Path',
  'copy-absolute-path': 'Copy Absolute Path',
  'quote-in-composer': 'Quote in Composer',
  retry: 'Edit this turn',
  'truncate-after': 'Revert to here',
  fork: 'Fork Chat',
  'side-chat': 'Start Side Chat',
  'open-changed-files': 'Open changed files',
  'apply-to-file': 'Apply to File…',
  'rerun-tool': 'Rerun tool',
};

const ZH_LABELS: LabelTable = {
  'generate-flashcard': '生成闪卡',
  'add-to-chat': '添加到对话',
  'ask-about': '询问…',
  'copy-as-ref': '复制为 @引用',
  explain: '解释',
  fix: '修复 / 改进',
  review: '审查',
  tests: '生成测试',
  'explain-failure': '解释失败原因',
  'fix-error': '修复此错误',
  open: '打开',
  reveal: '在文件管理器中显示',
  'save-as': '另存为…',
  copy: '复制',
  'copy-image': '复制图片',
  'copy-relative-path': '复制相对路径',
  'copy-absolute-path': '复制完整路径',
  'quote-in-composer': '引用到输入框',
  retry: '编辑此轮',
  'truncate-after': '回到此处',
  fork: '分叉会话',
  'side-chat': '打开侧聊',
  'open-changed-files': '打开变更文件',
  'apply-to-file': '应用到文件…',
  'rerun-tool': '重新运行工具',
};

const EN_SUBMENU_LABELS = { more: 'More…' } as const;
const ZH_SUBMENU_LABELS = { more: '更多…' } as const;

type SubmenuLabelTable = { more: string };

const ACTION_ICONS: Record<ContextMenuActionId, string> = {
  'generate-flashcard': 'cards',
  'add-to-chat': 'chat',
  'ask-about': 'spark',
  'copy-as-ref': 'link',
  explain: 'spark',
  fix: 'spark',
  review: 'check-circle',
  tests: 'code',
  'explain-failure': 'alert-circle',
  'fix-error': 'spark',
  open: 'file',
  reveal: 'folder',
  'save-as': 'download',
  copy: 'copy',
  'copy-image': 'copy',
  'copy-relative-path': 'copy',
  'copy-absolute-path': 'copy',
  'quote-in-composer': 'comment-plus',
  retry: 'refresh',
  'truncate-after': 'alert-circle',
  fork: 'arrow-fork',
  'side-chat': 'side-chat',
  'open-changed-files': 'file-diff',
  'apply-to-file': 'file',
  'rerun-tool': 'refresh',
};

const ACTION_SHORTCUTS: Partial<Record<ContextMenuActionId, string>> = {
  copy: '⌘C',
};

function labelsFor(locale: ContextMenuCapabilities['locale']): LabelTable {
  return locale === 'zh-CN' ? ZH_LABELS : EN_LABELS;
}

function submenuLabelsFor(locale: ContextMenuCapabilities['locale']): SubmenuLabelTable {
  return locale === 'zh-CN' ? ZH_SUBMENU_LABELS : EN_SUBMENU_LABELS;
}

function item(
  id: ContextMenuActionId,
  labels: LabelTable,
  options?: {
    disabled?: boolean;
    danger?: boolean;
    icon?: string;
    shortcut?: string;
    /** Appended when disabled — ContextMenuItem has no title/tooltip API. */
    disabledHint?: string;
  },
): ContextMenuItemSpec {
  const spec: Extract<ContextMenuItemSpec, { type: 'item' }> = {
    type: 'item',
    id,
    label: labels[id],
    testId: `context-menu-${id}`,
    icon: options?.icon ?? ACTION_ICONS[id],
  };
  const shortcut = options?.shortcut ?? ACTION_SHORTCUTS[id];
  if (shortcut) spec.shortcut = shortcut;
  if (options?.disabled) spec.disabled = true;
  if (options?.danger) spec.danger = true;
  // A disabled item keeps a clean label; the reason is a tooltip, not a suffix.
  if (options?.disabled && options.disabledHint) spec.title = options.disabledHint;
  return spec;
}

function sep(): ContextMenuItemSpec {
  return { type: 'separator' };
}

function compact(items: ContextMenuItemSpec[]): ContextMenuItemSpec[] {
  const out: ContextMenuItemSpec[] = [];
  for (const entry of items) {
    if (entry.type === 'separator') {
      if (out.length === 0 || out[out.length - 1]?.type === 'separator') continue;
      out.push(entry);
      continue;
    }
    out.push(entry);
  }
  while (out.length > 0 && out[out.length - 1]?.type === 'separator') {
    out.pop();
  }
  return out;
}

/** Build ordered menu items for a surface + capability snapshot. */
export function buildContextMenuItems(
  target: ContextMenuTarget,
  caps: ContextMenuCapabilities,
): ContextMenuItemSpec[] {
  const labels = labelsFor(caps.locale);
  const noProject = !caps.hasProject;
  const dormantHint = caps.locale === 'zh-CN' ? '现状禁用' : 'unavailable';
  const revealHint = caps.revealDisabledHint ?? dormantHint;

  switch (target.surface) {
    case 'file-tree-file':
      return compact([
        item('add-to-chat', labels, { disabled: noProject }),
        item('ask-about', labels, { disabled: noProject }),
        sep(),
        item('open', labels, {
          disabled: noProject || !caps.applyAvailable,
          disabledHint: dormantHint,
        }),
        item('reveal', labels, {
          disabled: noProject || !caps.canReveal,
          disabledHint: revealHint,
        }),
        sep(),
        item('copy-relative-path', labels, { disabled: noProject }),
        item('copy-absolute-path', labels, { disabled: noProject }),
        ...(noProject
          ? []
          : [
              {
                type: 'submenu' as const,
                id: 'more',
                label: submenuLabelsFor(caps.locale).more,
                icon: 'more',
                children: [
                  item('explain', labels),
                  item('review', labels),
                  item('tests', labels),
                ],
              },
            ]),
      ]);
    case 'file-tree-folder':
      return compact([
        item('add-to-chat', labels, { disabled: noProject }),
        item('ask-about', labels, { disabled: noProject }),
        sep(),
        item('reveal', labels, {
          disabled: noProject || !caps.canReveal,
          disabledHint: revealHint,
        }),
        item('copy-relative-path', labels, { disabled: noProject }),
        item('copy-absolute-path', labels, { disabled: noProject }),
      ]);
    case 'path-chip':
      return compact([
        item('open', labels),
        ...(caps.canSaveAs ? [item('save-as', labels)] : []),
        item('add-to-chat', labels, { disabled: noProject }),
        sep(),
        item('copy-relative-path', labels, { disabled: noProject }),
        item('copy-absolute-path', labels),
        // Keep Reveal visible when disabled so remote users see the hint
        // instead of a missing action.
        item('reveal', labels, {
          disabled: !caps.canReveal,
          ...(caps.canReveal ? {} : { disabledHint: revealHint }),
        }),
      ]);
    case 'selection': {
      const cannotSendPreset = !caps.canSendPreset;
      // Covers missing session and host-not-ready without blaming the wrong cause.
      const disabledHint = caps.locale === 'zh-CN' ? '会话未就绪' : 'requires an active chat';
      return compact([
        item('generate-flashcard', labels, {
          disabled: cannotSendPreset,
          ...(cannotSendPreset ? { disabledHint } : {}),
        }),
        item('add-to-chat', labels),
        ...(caps.sideChatAvailable ? [item('side-chat', labels)] : []),
        sep(),
        item('copy', labels),
      ]);
    }
    case 'code-block':
      return compact([
        item('copy', labels),
        item('add-to-chat', labels),
        item('ask-about', labels),
        item('apply-to-file', labels, { disabled: !caps.applyAvailable }),
        item('open', labels, { disabled: !target.relativePath || !caps.applyAvailable }),
      ]);
    case 'message-user':
    case 'message-assistant': {
      const capsMsg = target.capabilities;
      return compact([
        item('copy', labels),
        item('quote-in-composer', labels),
        sep(),
        ...(capsMsg.canRetry ? [item('retry', labels)] : []),
        item('truncate-after', labels, { danger: true }),
        ...(capsMsg.canFork ? [item('fork', labels)] : []),
        ...(capsMsg.canSideChat && caps.sideChatAvailable ? [item('side-chat', labels)] : []),
        sep(),
        item('add-to-chat', labels),
        ...(caps.openChangedFilesAvailable ? [item('open-changed-files', labels)] : []),
      ]);
    }
    case 'diff-row':
      return compact([
        item('open', labels, { disabled: !caps.applyAvailable }),
        item('add-to-chat', labels),
        item('explain', labels),
        item('review', labels),
        item('ask-about', labels),
      ]);
    case 'tool-card':
      return compact([
        item('copy', labels),
        item('add-to-chat', labels),
        item('explain-failure', labels),
        item('fix-error', labels),
        item('open', labels, { disabled: !target.relatedPath || !caps.applyAvailable }),
        ...(target.canRerun ? [item('rerun-tool', labels)] : []),
      ]);
    case 'terminal-selection':
    case 'error':
      return compact([
        item('add-to-chat', labels),
        item('explain-failure', labels),
        item('fix-error', labels),
        item('copy', labels),
        ...(caps.sideChatAvailable ? [item('side-chat', labels)] : []),
      ]);
    case 'media-image': {
      const cannotAdd = !caps.canAddMediaAttachment || !caps.canSendPreset;
      const disabledHint = caps.locale === 'zh-CN' ? '会话未就绪' : 'requires an active chat';
      const openLabel = caps.locale === 'zh-CN' ? '全屏查看' : 'View image';
      const openItem = item('open', labels, { icon: 'expand' });
      const labeledOpen =
        openItem.type === 'item' ? { ...openItem, label: openLabel } : openItem;
      return compact([
        item('save-as', labels, {
          disabled: caps.canSaveAs === false,
        }),
        item('copy-image', labels),
        ...(target.inLightbox === true ? [] : [labeledOpen]),
        sep(),
        item('add-to-chat', labels, {
          disabled: cannotAdd,
          ...(cannotAdd ? { disabledHint } : {}),
        }),
        item('ask-about', labels, {
          disabled: cannotAdd,
          ...(cannotAdd ? { disabledHint } : {}),
        }),
        // Reveal-in-folder only when the file is actually on this machine.
        // A generated / remote asset has no local location to open, so the
        // row is dropped rather than shown as a disabled apology.
        ...(caps.canReveal ? [sep(), item('reveal', labels)] : []),
      ]);
    }
    default: {
      const exhaustive: never = target;
      void exhaustive;
      return [];
    }
  }
}
