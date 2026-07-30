import type { RunActivityInput, ActivityIconSource } from './run-activity-types.js';
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

const WORKING_TOOL_ICON = 'Terminal';

function resolveLucideName(input: RunActivityInput): string {
  if (input.kind === 'working' && input.activeToolName) {
    return WORKING_TOOL_ICON;
  }
  return LUCIDE_NAME[input.kind] ?? 'Loader2';
}

export function resolveActivityIcon(input: RunActivityInput): ActivityIconSource {
  return {
    kind: input.kind,
    lucideName: resolveLucideName(input),
  };
}
