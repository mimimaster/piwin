/**
 * Right panel tab registry — shared by the panel, its plus menu, and tests.
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

/** Public tab id — `terminal` replaces legacy `activity`, terminal-* for multiple instances. */
export type RightPanelTab = RightPanelTabKind | `terminal-${string}`;

export function isTerminalTab(
  tab: string | null | undefined,
): tab is 'terminal' | `terminal-${string}` {
  return typeof tab === 'string' && (tab === 'terminal' || tab.startsWith('terminal-'));
}

export const SECTION_META: Array<{
  id: RightPanelTab;
  icon: ReactElement;
  labelEn: string;
  labelZh: string;
  /** Optional keyboard shortcut string for display in launcher (e.g. ⌥⌘S). */
  shortcut?: string;
  /** When true, the tab is reachable but not shown in the home list or + menu. */
  hidden?: boolean;
  /** Shown in the + menu, not the default home launcher. */
  plusOnly?: boolean;
}> = [
  { id: 'sideChat', icon: <IconSideChat />, labelEn: 'Side chat', labelZh: '侧聊', shortcut: '⌥⌘S' },
  { id: 'browser', icon: <IconBrowser />, labelEn: 'Browser', labelZh: '浏览器', shortcut: '⌘T' },
  { id: 'files', icon: <IconFile />, labelEn: 'Files', labelZh: '文件', shortcut: '⌘P' },
  { id: 'terminal', icon: <IconTerminal />, labelEn: 'zsh', labelZh: 'zsh', shortcut: '⌘J' },
  { id: 'tasks', icon: <IconActivity />, labelEn: 'Tasks', labelZh: '任务' },
  { id: 'review', icon: <IconGit />, labelEn: 'Changes', labelZh: '变更', shortcut: '⌥⌘G' },
  { id: 'notes', icon: <IconNote />, labelEn: 'Notes', labelZh: '笔记', plusOnly: true },
  { id: 'cards', icon: <IconCards />, labelEn: 'Flashcards', labelZh: '知识卡片', plusOnly: true },
  { id: 'canvas', icon: <IconDocument />, labelEn: 'Canvas', labelZh: '画布', hidden: true },
  { id: 'docPreview', icon: <IconDocument />, labelEn: 'Document', labelZh: '文档', hidden: true },
];

export function isHomeLauncherSection(entry: (typeof SECTION_META)[number]): boolean {
  return entry.hidden !== true && entry.plusOnly !== true;
}

export function isPlusMenuSection(entry: (typeof SECTION_META)[number]): boolean {
  return entry.hidden !== true;
}

export function sectionLabel(tab: RightPanelTab, locale: DesktopLocale): string {
  if (tab.startsWith('terminal-')) {
    const num = tab.slice('terminal-'.length);
    return `zsh${num}`;
  }
  const item = SECTION_META.find((entry) => entry.id === tab);
  if (!item) return tab;
  return locale === 'zh-CN' ? item.labelZh : item.labelEn;
}

export function sectionIcon(tab: RightPanelTab): ReactElement | null {
  if (tab.startsWith('terminal-')) {
    return <IconTerminal />;
  }
  return SECTION_META.find((entry) => entry.id === tab)?.icon ?? null;
}
