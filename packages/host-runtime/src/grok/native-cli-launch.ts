import type { SessionBackendBinding } from '@piwin/contracts';
import type { InteractiveTerminalInput } from '@piwin/process';
import type { HostRuntimeKernel } from '../host-runtime-kernel.js';
import { AgentCliError } from './native-cli-error.js';
import { buildGrokCliLaunch } from './grok-cli-launch.js';

export async function resolveNativeCliLaunch(
  deps: HostRuntimeKernel,
  input: {
    agentId: string;
    sessionId: string;
    nativeId: string;
    executable: string;
    cwd: string;
    cols: number;
    rows: number;
    binding: SessionBackendBinding | undefined;
  },
): Promise<InteractiveTerminalInput> {
  const binding = input.binding;
  if (binding === undefined) throw new AgentCliError('session-unavailable', 'agent-cli-session-unavailable');

  // Prefer generic session/cli-launch when a resident handle can serve it.
  const handle = deps.sessions.get(input.sessionId) as
    | {
        cliLaunch?: (
          expected: string,
        ) => Promise<{ backendSessionId: string; args: readonly string[] }>;
      }
    | undefined;
  if (handle?.cliLaunch !== undefined) {
    try {
      const descriptor = await handle.cliLaunch(input.nativeId);
      return {
        executable: input.executable,
        args: [...descriptor.args],
        cwd: input.cwd,
        cols: input.cols,
        rows: input.rows,
      };
    } catch (error) {
      // Grok-only legacy path when the old adapter lacks the new method.
      if (input.agentId !== 'grok') throw error;
    }
  }

  if (input.agentId === 'grok') {
    return buildGrokCliLaunch({
      binding,
      executable: input.executable,
      cwd: input.cwd,
      cols: input.cols,
      rows: input.rows,
    });
  }
  throw new AgentCliError('cli-unsupported', 'cli-launch-unavailable');
}
