import type { RunActivityInput, ActivityIconSource, ActivityActionCategory } from './run-activity-types.js';
import type { RunStatusKind } from './run-status.js';

const LUCIDE_NAME: Record<RunStatusKind, string> = {
  idle: 'Circle',
  preparing: 'Settings',
  'connecting-model': 'Wifi',
  'waiting-first-token': 'Sparkles',
  planning: 'Map',
  working: 'Code',
  'waiting-permission': 'ShieldQuestion',
  compacting: 'Minimize2',
  stopping: 'Square',
  stopped: 'Circle',
  failed: 'XCircle',
  complete: 'CheckCircle2',
};

export function resolveActionCategory(input: RunActivityInput): ActivityActionCategory | undefined {
  if (input.actionCategory) {
    return input.actionCategory;
  }

  if (input.kind === 'waiting-first-token') {
    return 'thinking';
  }
  if (input.kind === 'planning') {
    return 'planning';
  }
  if (input.kind === 'waiting-permission') {
    return 'ask';
  }

  const tool = input.activeToolName?.toLowerCase() ?? '';
  if (!tool) return undefined;

  if (tool.includes('command') || tool.includes('bash') || tool.includes('exec') || tool.includes('terminal')) {
    return 'terminal';
  }
  if (
    tool.includes('write') ||
    tool.includes('replace') ||
    tool.includes('edit') ||
    tool.includes('create')
  ) {
    return 'edit';
  }
  if (
    tool.includes('grep') ||
    tool.includes('search') ||
    tool.includes('view') ||
    tool.includes('read_file') ||
    tool.includes('list')
  ) {
    return 'search';
  }
  if (tool.includes('web') || tool.includes('url') || tool.includes('fetch') || tool.includes('browser')) {
    return 'web';
  }
  if (tool.includes('subagent') || tool.includes('send_message')) {
    return 'subagent';
  }
  if (tool.includes('ask') || tool.includes('question')) {
    return 'ask';
  }

  return undefined;
}

function resolveLucideName(input: RunActivityInput, category?: ActivityActionCategory): string {
  if (category === 'terminal') return 'Terminal';
  if (category === 'edit') return 'FileCode';
  if (category === 'search') return 'Search';
  if (category === 'web') return 'Globe';
  if (category === 'subagent') return 'Bot';
  if (category === 'ask') return 'HelpCircle';
  const defaultIcon = LUCIDE_NAME[input.kind as keyof typeof LUCIDE_NAME];
  return defaultIcon ?? 'Loader2';
}

export function resolveActivityIcon(input: RunActivityInput): ActivityIconSource {
  const category = resolveActionCategory(input);
  return {
    kind: input.kind,
    ...(category ? { actionCategory: category } : {}),
    lucideName: resolveLucideName(input, category),
  };
}

