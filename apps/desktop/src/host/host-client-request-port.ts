import type { HostCommand, HostResponse } from '@piwin/contracts';

/**
 * Minimal client port a command-domain module needs: the request dispatcher
 * only. Builders stay usable with a real `HostClient` and with test doubles.
 */
export type HostCommandRequestClient = {
  request: (command: HostCommand) => Promise<HostResponse>;
};
