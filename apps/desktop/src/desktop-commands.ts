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
  | 'open-workspace';

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
    title: 'Open Activity',
    keywords: ['terminal', 'shell', 'activity', 'logs'],
    shortcut: '⌘J',
  },
  {
    id: 'open-settings',
    title: 'Open Settings',
    keywords: ['settings', 'preferences', 'config'],
  },
  {
    id: 'open-workspace',
    title: 'Open Workspace',
    keywords: ['workspace', 'project', 'folder', 'open'],
  },
];

export type CommandAvailability = {
  available: boolean;
  reason?: string;
};

export function filterDesktopCommands(query: string): DesktopCommand[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
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
