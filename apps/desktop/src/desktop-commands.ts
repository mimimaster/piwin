/**
 * Command palette catalog — pure matching + availability labels.
 */

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

export type DesktopCommand = {
  id: DesktopCommandId;
  title: string;
  keywords: string[];
  shortcut?: string;
};

export const DESKTOP_COMMANDS: DesktopCommand[] = [
  {
    id: 'new-session',
    title: 'New session',
    keywords: ['new', 'session', 'agent', 'chat'],
    shortcut: '⌘N',
  },
  {
    // R2: the session tab strip was removed, so this is the only ⌘K path to
    // reach another session. It opens the sidebar with the session search
    // focused, which *is* session switching — hence no separate
    // "switch-session" command. The extra keywords keep "switch session" /
    // "jump to session" queries discoverable ("goto" also carries the "to"
    // token so multi-word queries still match).
    id: 'search-sessions',
    title: 'Search sessions',
    keywords: ['search', 'find', 'agents', 'sessions', 'switch', 'jump', 'goto', 'recent'],
    shortcut: '⇧⌘F',
  },
  {
    id: 'focus-composer',
    title: 'Focus Composer',
    keywords: ['composer', 'prompt', 'input', 'focus'],
    shortcut: '⌘L',
  },
  {
    id: 'toggle-inspector',
    title: 'Toggle Inspector',
    keywords: ['inspector', 'execution', 'activity', 'tools', 'files', 'review'],
    shortcut: '⇧⌘I',
  },
  {
    id: 'open-activity',
    title: 'Open Terminal',
    // Keep "activity" keyword so existing command palette queries still hit this id.
    keywords: ['terminal', 'shell', 'pty', 'console', 'activity'],
    shortcut: '⌘J',
  },
  {
    id: 'open-settings',
    title: 'Open Settings',
    keywords: ['settings', 'preferences', 'config'],
    shortcut: '⌘,',
  },
  {
    id: 'open-workspace',
    title: 'Open Workspace',
    keywords: ['workspace', 'project', 'folder', 'open'],
    shortcut: '⌘O',
  },
  {
    id: 'toggle-sidebar',
    title: 'Toggle Sidebar',
    keywords: ['sidebar', 'sessions', 'navigation', 'toggle'],
    shortcut: '⌘B',
  },
  {
    id: 'toggle-right-panel',
    title: 'Toggle Right Panel',
    keywords: ['right panel', 'inspector', 'toggle', 'panel'],
    shortcut: '⌘\\',
  },
  {
    id: 'stop-run',
    title: 'Stop Run',
    keywords: ['stop', 'abort', 'cancel', 'interrupt'],
    shortcut: '⌘.',
  },
  {
    id: 'switch-tab-1',
    title: 'Switch to Files',
    keywords: ['switch', 'tab', 'files', '1'],
    shortcut: '⌘1',
  },
  {
    id: 'switch-tab-2',
    title: 'Switch to Terminal',
    keywords: ['switch', 'tab', 'terminal', '2'],
    shortcut: '⌘2',
  },
  {
    id: 'switch-tab-3',
    title: 'Switch to Changes',
    keywords: ['switch', 'tab', 'review', 'changes', '3'],
    shortcut: '⌘3',
  },
  {
    id: 'switch-tab-4',
    title: 'Switch to Browser',
    keywords: ['switch', 'tab', 'browser', '4'],
    shortcut: '⌘4',
  },
  {
    id: 'switch-tab-5',
    title: 'Switch to Document',
    keywords: ['switch', 'tab', 'document', 'preview', 'doc', '5'],
    shortcut: '⌘5',
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
    const haystack = `${command.title} ${command.keywords.join(' ')}`.toLowerCase();
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
): CommandAvailability {
  if (commandId === 'new-session') {
    if (!context.hasProject) {
      return { available: false, reason: 'Open a workspace first' };
    }
    if (!context.projectTrusted) {
      return { available: false, reason: 'Trust the project first' };
    }
    return { available: true };
  }
  if (commandId === 'focus-composer') {
    if (!context.hasActiveSession) {
      return { available: false, reason: 'Start or select a session first' };
    }
    if (!context.projectTrusted) {
      return { available: false, reason: 'Trust the project first' };
    }
    return { available: true };
  }
  if (commandId === 'search-sessions' && !context.hasProject) {
    return { available: false, reason: 'Open a workspace first' };
  }
  return { available: true };
}
