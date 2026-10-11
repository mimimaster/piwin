import type { SessionBackendBinding } from '@piwin/contracts';
import type { InteractiveTerminalInput } from '@piwin/process';

/** The vendor id is never the product id; --resume is required for an existing session. */
export function buildGrokCliLaunch(input: {
  binding: SessionBackendBinding;
  executable: string;
  cwd: string;
  cols: number;
  rows: number;
}): InteractiveTerminalInput {
  if (input.binding.agentId !== 'grok' || !input.binding.backendSessionId) {
    throw new Error('grok-native-session-required');
  }
  return {
    executable: input.executable,
    args: ['--fullscreen', '--cwd', input.cwd, '--resume', input.binding.backendSessionId],
    cwd: input.cwd, cols: input.cols, rows: input.rows,
  };
}
