import type { ExecutionMode } from '@piwin/contracts';

export function resolveExecutionMode(mode: ExecutionMode | undefined): ExecutionMode {
  if (mode === 'chat' || mode === 'agent' || mode === 'agent-debug') {
    return mode;
  }
  return 'agent';
}
