/**
 * Right panel tab registry — shared by the panel, its plus menu, and tests.
 */

import type { ReactElement } from 'react';
import { IconBrowser, IconDocument, IconFolder, IconGit, IconTerminal } from './shell-icons';
import type { DesktopLocale } from './desktop-locale';
import type { RightPanelTabKind } from './right-panel-memory';

/** Public tab id — `terminal` replaces legacy `activity`. */
export type RightPanelTab = RightPanelTabKind;

export const SECTION_META: Array<{
  id: RightPanelTab;
  icon: ReactElement;
  labelEn: string;
  labelZh: string;
}> = [
  { id: 'files', icon: <IconFolder />, labelEn: 'File', labelZh: '文件' },
  { id: 'terminal', icon: <IconTerminal />, labelEn: 'Terminal', labelZh: '终端' },
  { id: 'browser', icon: <IconBrowser />, labelEn: 'Browser', labelZh: '浏览器' },
  { id: 'review', icon: <IconGit />, labelEn: 'Changes', labelZh: '变更' },
  { id: 'docPreview', icon: <IconDocument />, labelEn: 'Document', labelZh: '文档' },
];

export function sectionLabel(tab: RightPanelTab, locale: DesktopLocale): string {
  const item = SECTION_META.find((entry) => entry.id === tab);
  if (!item) return tab;
  return locale === 'zh-CN' ? item.labelZh : item.labelEn;
}

export function sectionIcon(tab: RightPanelTab): ReactElement | null {
  return SECTION_META.find((entry) => entry.id === tab)?.icon ?? null;
}
