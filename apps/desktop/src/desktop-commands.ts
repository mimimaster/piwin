/**
 * Command palette catalog — pure matching + availability labels.
 */

import type { DesktopLocale } from './desktop-locale.js';

export type DesktopCommandId =
  | 'palette'
  | 'new-session'
  | 'search-sessions'
  | 'focus-composer'
  | 'toggle-inspector'
  | 'open-activity'
  | 'open-settings'
  | 'open-workspace'
  | 'toggle-sidebar'
  | 'toggle-right-panel'
  | 'stop-run'
  | 'switch-tab-1'
  | 'switch-tab-2'
  | 'switch-tab-3'
  | 'switch-tab-4'
  | 'switch-tab-5';

export type DesktopCommandGroup = 'session' | 'composer' | 'panel' | 'workspace';

export type DesktopCommandIcon =
  | 'plus'
  | 'search'
  | 'composer'
  | 'inspector'
  | 'terminal'
  | 'settings'
  | 'folder'
  | 'sidebar'
  | 'panel'
  | 'stop'
  | 'file'
  | 'changes'
  | 'browser'
  | 'document';

export type DesktopCommand = {
  id: DesktopCommandId;
  title: string;
  titleZh: string;
  group: DesktopCommandGroup;
  icon: DesktopCommandIcon;
  keywords: string[];
  shortcut?: string;
};

export const COMMAND_GROUP_ORDER: DesktopCommandGroup[] = [
  'session',
  'composer',
  'panel',
  'workspace',
];

export function commandGroupLabel(
  group: DesktopCommandGroup,
  locale: DesktopLocale,
): string {
  const labels: Record<DesktopLocale, Record<DesktopCommandGroup, string>> = {
    'zh-CN': {
      session: '会话',
      composer: '作曲器',
      panel: '检视器',
      workspace: '工作区',
    },
    en: {
      session: 'Session',
      composer: 'Composer',
      panel: 'Inspector',
      workspace: 'Workspace',
    },
  };
  return labels[locale][group];
}

export function commandTitle(command: DesktopCommand, locale: DesktopLocale): string {
  return locale === 'zh-CN' ? command.titleZh : command.title;
}

export const DESKTOP_COMMANDS: DesktopCommand[] = [
  {
    id: 'new-session',
    title: 'New session',
    titleZh: '新建会话',
    group: 'session',
    icon: 'plus',
    keywords: ['new', 'session', 'agent', 'chat', '新建', '会话'],
    shortcut: '⌘N',
  },
  {
    id: 'search-sessions',
    title: 'Search sessions',
    titleZh: '搜索会话',
    group: 'session',
    icon: 'search',
    keywords: ['search', 'find', 'agents', 'sessions', 'switch', 'jump', 'goto', 'recent', '搜索'],
    shortcut: '⇧⌘F',
  },
  {
    id: 'focus-composer',
    title: 'Focus Composer',
    titleZh: '聚焦作曲器',
    group: 'composer',
    icon: 'composer',
    keywords: ['composer', 'prompt', 'input', 'focus', '作曲器'],
    shortcut: '⌘L',
  },
  {
    id: 'stop-run',
    title: 'Stop Run',
    titleZh: '停止运行',
    group: 'composer',
    icon: 'stop',
    keywords: ['stop', 'abort', 'cancel', 'interrupt', '停止'],
    shortcut: '⌘.',
  },
  {
    id: 'toggle-inspector',
    title: 'Toggle Inspector',
    titleZh: '开关检视器',
    group: 'panel',
    icon: 'inspector',
    keywords: ['inspector', 'execution', 'activity', 'tools', 'files', 'review', '检视器'],
    shortcut: '⇧⌘I',
  },
  {
    id: 'open-activity',
    title: 'Open Terminal',
    titleZh: '打开终端',
    group: 'panel',
    icon: 'terminal',
    keywords: ['terminal', 'shell', 'pty', 'console', 'activity', '终端'],
    shortcut: '⌘J',
  },
  {
    id: 'switch-tab-1',
    title: 'Switch to Files',
    titleZh: '切换到文件',
    group: 'panel',
    icon: 'file',
    keywords: ['switch', 'tab', 'files', '1', '文件'],
    shortcut: '⌘1',
  },
  {
    id: 'switch-tab-2',
    title: 'Switch to Terminal',
    titleZh: '切换到终端',
    group: 'panel',
    icon: 'terminal',
    keywords: ['switch', 'tab', 'terminal', '2', '终端'],
    shortcut: '⌘2',
  },
  {
    id: 'switch-tab-3',
    title: 'Switch to Changes',
    titleZh: '切换到变更',
    group: 'panel',
    icon: 'changes',
    keywords: ['switch', 'tab', 'review', 'changes', '3', '变更'],
    shortcut: '⌘3',
  },
  {
    id: 'switch-tab-4',
    title: 'Switch to Browser',
    titleZh: '切换到浏览器',
    group: 'panel',
    icon: 'browser',
    keywords: ['switch', 'tab', 'browser', '4', '浏览器'],
    shortcut: '⌘4',
  },
  {
    id: 'switch-tab-5',
    title: 'Switch to Document',
    titleZh: '切换到文档',
    group: 'panel',
    icon: 'document',
    keywords: ['switch', 'tab', 'document', 'preview', 'doc', '5', '文档'],
    shortcut: '⌘5',
  },
  {
    id: 'open-settings',
    title: 'Open Settings',
    titleZh: '打开设置',
    group: 'workspace',
    icon: 'settings',
    keywords: ['settings', 'preferences', 'config', '设置'],
    shortcut: '⌘,',
  },
  {
    id: 'open-workspace',
    title: 'Open Workspace',
    titleZh: '打开工作区',
    group: 'workspace',
    icon: 'folder',
    keywords: ['workspace', 'project', 'folder', 'open', '工作区'],
    shortcut: '⌘O',
  },
  {
    id: 'toggle-sidebar',
    title: 'Toggle Sidebar',
    titleZh: '开关侧栏',
    group: 'workspace',
    icon: 'sidebar',
    keywords: ['sidebar', 'sessions', 'navigation', 'toggle', '侧栏'],
    shortcut: '⌘B',
  },
  {
    id: 'toggle-right-panel',
    title: 'Toggle Right Panel',
    titleZh: '开关右侧面板',
    group: 'workspace',
    icon: 'panel',
    keywords: ['right panel', 'inspector', 'toggle', 'panel', '面板'],
    shortcut: '⌘\\',
  },
];

export type CommandAvailability = {
  available: boolean;
  reason?: string;
};

export function filterDesktopCommands(query: string): DesktopCommand[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return DESKTOP_COMMANDS;
  }
  return DESKTOP_COMMANDS.filter((command) => {
    const haystack = `${command.title} ${command.titleZh} ${command.keywords.join(' ')}`.toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}

export function commandAvailability(
  commandId: DesktopCommandId,
  context: {
    hasProject: boolean;
    projectTrusted: boolean;
    hasActiveSession: boolean;
  },
  locale: DesktopLocale = 'en',
): CommandAvailability {
  const isChinese = locale === 'zh-CN';
  if (commandId === 'new-session') {
    if (!context.hasProject) {
      return {
        available: false,
        reason: isChinese ? '请先打开工作区' : 'Open a workspace first',
      };
    }
    if (!context.projectTrusted) {
      return {
        available: false,
        reason: isChinese ? '请先信任此项目' : 'Trust the project first',
      };
    }
    return { available: true };
  }
  if (commandId === 'focus-composer') {
    if (!context.hasActiveSession) {
      return {
        available: false,
        reason: isChinese ? '请先开始或选择一个会话' : 'Start or select a session first',
      };
    }
    if (!context.projectTrusted) {
      return {
        available: false,
        reason: isChinese ? '请先信任此项目' : 'Trust the project first',
      };
    }
    return { available: true };
  }
  return { available: true };
}
