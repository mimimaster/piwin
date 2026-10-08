/**
 * Right panel tab registry — shared by the panel, its plus menu, and tests.
 *
 * A tab id is an instance: `browser`, `browser-2`, or a terminal session
 * (`terminal-1`). The registry below lists tool kinds, which the + menu opens.
 */

import type { ReactElement } from 'react';
import {
  IconBrowser,
  IconCards,
  IconDocument,
  IconFile,
  IconGit,
  IconNote,
  IconSideChat,
  IconTerminal,
  IconActivity,
} from './shell-icons';
import type { DesktopLocale } from './desktop-locale';
import type { RightPanelTabKind } from './right-panel-memory';
import {
  allocateRightPanelInstanceId,
  insertTabAfterActive,
  isRightPanelInstanceTab,
  rightPanelTabKind,
  type RightPanelToolKind,
} from './right-panel-instances';

/** Public tab id — one open instance of a tool. */
export type RightPanelTab = RightPanelTabKind;

export type { RightPanelToolKind };
export { rightPanelTabKind, isRightPanelInstanceTab, allocateRightPanelInstanceId, insertTabAfterActive };

export function isTerminalTab(
  tab: string | null | undefined,
): tab is 'terminal' | `terminal-${string}` {
  return typeof tab === 'string' && isRightPanelInstanceTab(tab, 'terminal');
}

export const SECTION_META: Array<{
  id: RightPanelToolKind;
  icon: ReactElement;
  labelEn: string;
  labelZh: string;
  /** Optional keyboard shortcut string for display in launcher (e.g. ⌥⌘S). */
  shortcut?: string;
  /** When true, the tab is reachable but not shown in the home list or + menu. */
  hidden?: boolean;
  /** Shown in the + menu, not the default home launcher. */
  plusOnly?: boolean;
  /** Shown in the home launcher, not the + menu. */
  homeOnly?: boolean;
}> = [
  { id: 'sideChat', icon: <IconSideChat />, labelEn: 'Side chat', labelZh: '侧聊', shortcut: '⌥⌘S' },
  { id: 'browser', icon: <IconBrowser />, labelEn: 'Browser', labelZh: '浏览器', shortcut: '⌘T' },
  { id: 'files', icon: <IconFile />, labelEn: 'Files', labelZh: '文件', shortcut: '⌘P' },
  { id: 'terminal', icon: <IconTerminal />, labelEn: 'zsh', labelZh: 'zsh', shortcut: '⌘J' },
  { id: 'tasks', icon: <IconActivity />, labelEn: 'Tasks', labelZh: '任务' },
  // Changes is one view of the workspace; the + menu does not open another.
  { id: 'review', icon: <IconGit />, labelEn: 'Changes', labelZh: '变更', shortcut: '⌥⌘G', homeOnly: true },
  { id: 'notes', icon: <IconNote />, labelEn: 'Notes', labelZh: '笔记', plusOnly: true },
  { id: 'cards', icon: <IconCards />, labelEn: 'Flashcards', labelZh: '知识卡片', plusOnly: true },
  { id: 'canvas', icon: <IconDocument />, labelEn: 'Canvas', labelZh: '画布', hidden: true },
  { id: 'docPreview', icon: <IconDocument />, labelEn: 'Document', labelZh: '文档', hidden: true },
];

export function isHomeLauncherSection(entry: (typeof SECTION_META)[number]): boolean {
  return entry.hidden !== true && entry.plusOnly !== true;
}

export function isPlusMenuSection(entry: (typeof SECTION_META)[number]): boolean {
  return entry.hidden !== true && entry.homeOnly !== true;
}

function kindMeta(kind: RightPanelToolKind | null): (typeof SECTION_META)[number] | undefined {
  return SECTION_META.find((entry) => entry.id === kind);
}

/** `Browser`, `Browser 2` — the first instance keeps the plain tool name. */
export function sectionLabel(tab: RightPanelTab, locale: DesktopLocale): string {
  const kind = rightPanelTabKind(tab);
  if (kind === 'terminal') {
    if (tab === 'terminal') return 'zsh';
    const suffix = tab.slice('terminal-'.length);
    return suffix.length > 0 ? `zsh${suffix}` : 'zsh';
  }
  const item = kindMeta(kind);
  if (!item) return tab;
  const base = locale === 'zh-CN' ? item.labelZh : item.labelEn;
  if (!kind || tab === kind) return base;
  const suffix = tab.slice(kind.length + 1);
  return suffix.length > 0 ? `${base} ${suffix}` : base;
}

export function sectionIcon(tab: RightPanelTab): ReactElement | null {
  const kind = rightPanelTabKind(tab);
  return kindMeta(kind)?.icon ?? null;
}
