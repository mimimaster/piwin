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

const GENERATED_SRC: Record<RunStatusKind, string | undefined> = {
  idle: '/ui/run-state-idle.png',
  preparing: '/ui/run-state-preparing.png',
  'connecting-model': '/ui/run-state-connecting-model.png',
  'waiting-first-token': '/ui/run-state-waiting-first-token.png',
  planning: '/ui/run-state-planning.png',
  working: '/ui/run-state-working.png',
  'waiting-permission': '/ui/run-state-waiting-permission.png',
  compacting: '/ui/run-state-compacting.png',
  stopping: '/ui/run-state-stopping.png',
  stopped: '/ui/run-state-stopped.png',
  failed: '/ui/run-state-failed.png',
  complete: '/ui/run-state-complete.png',
};

function resolveLucideName(input: RunActivityInput): string {
  if (input.kind === 'working' && input.activeToolName) {
    return WORKING_TOOL_ICON;
  }
  return LUCIDE_NAME[input.kind] ?? 'Loader2';
}

function resolveGeneratedSrc(input: RunActivityInput): string | undefined {
  if (input.kind === 'working' && input.activeToolName) {
    return '/ui/run-state-tool-running.png';
  }
  return GENERATED_SRC[input.kind];
}

export function resolveActivityIcon(input: RunActivityInput): ActivityIconSource {
  const imgSrc = resolveGeneratedSrc(input);
  return {
    kind: input.kind,
    lucideName: resolveLucideName(input),
    ...(imgSrc !== undefined ? { imgSrc } : {}),
  };
}
