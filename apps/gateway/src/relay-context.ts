import type { WebSocket } from 'ws';
import type { RelayEnrollToken } from './relay-enroll-token.js';
import type { RelayLimits } from './relay-limits.js';
import type { RelayLogger } from './relay-log.js';
import type { RelayRooms } from './relay-rooms.js';
import type { RelayUserRegistry } from './relay-user-registry.js';

/** Shared state every relay session reads; owned by the relay server. */
export type RelayContext = {
  registry: RelayUserRegistry;
  rooms: RelayRooms<WebSocket>;
  limits: RelayLimits;
  enrollToken: RelayEnrollToken | undefined;
  /** Writes the registry after a self-enrollment. */
  persistRegistry: () => Promise<void>;
  log: RelayLogger;
};

export type RelayRoute = { userId: string; hostId: string };

const OPEN = 1;

/**
 * Sends one frame unless the target's backlog is past the limit, in which case
 * the target is closed: the relay keeps no buffer, and the client catches up
 * through Host replay after it reconnects.
 */
export function sendWithinBudget(
  context: RelayContext,
  target: WebSocket,
  data: Uint8Array | string,
): void {
  if (target.readyState !== OPEN) {
    return;
  }
  if (target.bufferedAmount > context.limits.maxSendBufferBytes) {
    target.close(4429, 'send buffer exceeded');
    return;
  }
  target.send(data);
}

export function toBytes(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return data instanceof ArrayBuffer ? new Uint8Array(data) : data;
}
