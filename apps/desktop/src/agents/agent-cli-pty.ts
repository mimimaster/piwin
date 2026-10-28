import type { AgentCliOpenInput } from '@piwin/contracts';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { hostPtyTransport, requestHostPty, type HostPtyClient } from '../terminal/host-pty-transport.js';
import type { XtermPty } from '../terminal/xterm-pty-transport.js';

export type AgentCliHost = HostPtyClient;

/** Native Grok runs on the selected Host; no executable or filesystem path comes back. */
export function createAgentCliPty(
  host: AgentCliHost,
  input: Omit<AgentCliOpenInput, 'cols' | 'rows'>,
  onSession: (sessionId: string) => void,
): XtermPty {
  return {
    open: async (size) => {
      const data = await requestHostPty(host, { type: 'agents/cli-open', input: { ...input, ...size } }, { idempotencyKey: createGestureIdempotencyKey() });
      if (data === null || typeof data !== 'object' || !('ptyId' in data) || !('sessionId' in data) || typeof data.ptyId !== 'string' || typeof data.sessionId !== 'string') throw new Error('Invalid agent terminal response');
      onSession(data.sessionId);
      return { pty_id: data.ptyId, ...('initialOutput' in data && typeof data.initialOutput === 'string' ? { initial_output: data.initialOutput, ...('initialOutputThrough' in data && typeof data.initialOutputThrough === 'number' ? { output_through: data.initialOutputThrough } : {}) } : {}) };
    },
    transport: hostPtyTransport(host),
  };
}
