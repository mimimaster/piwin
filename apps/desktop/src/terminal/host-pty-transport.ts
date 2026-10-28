import type { HostCommand } from '@piwin/contracts';
import type { HostClient } from '../host/host-client.js';
import type { XtermPtyTransport } from './xterm-pty-transport.js';

export type HostPtyClient = Pick<HostClient, 'request' | 'subscribe'>;

/** Sends one Host command and returns its data, or throws the Host's error. */
export async function requestHostPty(
  host: HostPtyClient,
  command: HostCommand,
  options?: Parameters<HostClient['request']>[1],
): Promise<unknown> {
  const response = options === undefined ? await host.request(command) : await host.request(command, options);
  if (!response.success) throw new Error(response.error);
  return response.data;
}

/**
 * xterm I/O for a terminal running on the Host's machine (native agent CLIs,
 * the Host-run TUI): bytes arrive as `pty/output` pushes, input goes back as
 * `pty/write`.
 */
export function hostPtyTransport(host: HostPtyClient): XtermPtyTransport {
  return {
    listenData: async (handler) => host.subscribe((push) => {
      if (push.type === 'pty/output') handler({ pty_id: push.ptyId, data: push.data, ...(push.sequence === undefined ? {} : { sequence: push.sequence }) });
    }),
    listenExit: async (handler) => host.subscribe((push) => {
      if (push.type === 'pty/exit') handler({ pty_id: push.ptyId, ...(push.exitCode === undefined ? {} : { exit_code: push.exitCode }) });
    }),
    write: async (ptyId, data) => { await requestHostPty(host, { type: 'pty/write', ptyId, data }); },
    resize: async (ptyId, cols, rows) => { await requestHostPty(host, { type: 'pty/resize', ptyId, cols, rows }); },
    close: async (ptyId) => { await requestHostPty(host, { type: 'pty/close', ptyId }); },
  };
}
