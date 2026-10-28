import type { EmbeddedTuiOpenInput } from '@piwin/contracts';
import { createGestureIdempotencyKey } from '../gesture-idempotency.js';
import { hostPtyTransport, requestHostPty, type HostPtyClient } from './host-pty-transport.js';
import type { XtermPty } from './xterm-pty-transport.js';

/**
 * The terminal shell run by the Host (ADR 0102), for shells that cannot open
 * a terminal themselves. The session it shows arrives in its own output, as
 * on Desktop; reopening a session it already shows hands back that process.
 */
export function createHostTuiPty(
  host: HostPtyClient,
  input: Omit<EmbeddedTuiOpenInput, 'cols' | 'rows'>,
): XtermPty {
  return {
    open: async (size) => {
      const data = await requestHostPty(host, { type: 'tui/open', input: { ...input, ...size } }, { idempotencyKey: createGestureIdempotencyKey() });
      if (data === null || typeof data !== 'object' || !('ptyId' in data) || typeof data.ptyId !== 'string') {
        throw new Error('Invalid terminal shell response');
      }
      return { pty_id: data.ptyId };
    },
    transport: hostPtyTransport(host),
  };
}
