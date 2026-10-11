import type { AgentCliOpenInput, HostCommand } from '@piwin/contracts';
import type { HostClient } from './host-client.js';
import { createGestureIdempotencyKey } from './gesture-idempotency.js';
import type { XtermPty } from './xterm-pty-transport.js';

export type AgentCliHost = Pick<HostClient, 'request' | 'subscribe'>;

/** Native Grok runs on the selected Host; no executable or filesystem path comes back. */
export function createAgentCliPty(
  host: AgentCliHost,
  input: Omit<AgentCliOpenInput, 'cols' | 'rows'>,
  onSession: (sessionId: string) => void,
): XtermPty {
  const request = async (command: HostCommand): Promise<unknown> => {
    const response = command.type === 'agents/cli-open'
      ? await host.request(command, { idempotencyKey: createGestureIdempotencyKey() })
      : await host.request(command);
    if (!response.success) throw new Error(response.error);
    return response.data;
  };
  return {
    open: async (size) => {
      const data = await request({ type: 'agents/cli-open', input: { ...input, ...size } });
      if (data === null || typeof data !== 'object' || !('ptyId' in data) || !('sessionId' in data) || typeof data.ptyId !== 'string' || typeof data.sessionId !== 'string') throw new Error('Invalid agent terminal response');
      onSession(data.sessionId);
      return { pty_id: data.ptyId };
    },
    transport: {
      listenData: async (handler) => host.subscribe((push) => {
        if (push.type === 'pty/output') handler({ pty_id: push.ptyId, data: push.data });
      }),
      listenExit: async (handler) => host.subscribe((push) => {
        if (push.type === 'pty/exit') handler({ pty_id: push.ptyId, ...(push.exitCode === undefined ? {} : { exit_code: push.exitCode }) });
      }),
      write: async (ptyId, data) => { await request({ type: 'pty/write', ptyId, data }); },
      resize: async (ptyId, cols, rows) => { await request({ type: 'pty/resize', ptyId, cols, rows }); },
      close: async (ptyId) => { await request({ type: 'pty/close', ptyId }); },
    },
  };
}
