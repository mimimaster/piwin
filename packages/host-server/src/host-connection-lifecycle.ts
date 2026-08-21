/** Structured Host connection lifecycle events for operator logs (no secrets). */
export type HostConnectionEvent = {
  phase:
    | 'accept'
    | 'hello-ok'
    | 'hello-reject'
    | 'replay-done'
    | 'snapshot'
    | 'hydration'
    | 'close'
    | 'idle-terminate'
    | 'slow-consumer';
  connectionId: string;
  clientId?: string;
  deviceId?: string;
  code?: number;
  reason?: string;
  seq?: number;
  replayBytes?: number;
};

export const HOST_SOCKET_SEND_BUDGET_BYTES = 4 * 1024 * 1024;
export const HOST_IDLE_CONNECTION_MS = 90_000;
export const HOST_LIVENESS_SWEEP_MS = 15_000;

/**
 * Commands that must not wait behind session/list / media / settings on the
 * same socket. Heartbeat and turn control stay interactive under load.
 */
export function isHostIngressBypassCommand(commandType: string): boolean {
  return (
    commandType === 'host/ping' ||
    commandType === 'session/prompt' ||
    commandType === 'session/abort' ||
    commandType === 'session/steer' ||
    commandType === 'session/follow_up' ||
    commandType === 'session/pause' ||
    commandType === 'session/resume-run' ||
    commandType === 'permission/resolve'
  );
}

export function compareClientVersions(clientVersion: string, minClientVersion: string): number {
  const left = parseVersionParts(clientVersion);
  const right = parseVersionParts(minClientVersion);
  for (let index = 0; index < 3; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

function parseVersionParts(value: string): number[] {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (match === null) {
    return [0, 0, 0];
  }
  return [Number(match[1] ?? 0), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export async function waitForSocketSendBudget(
  bufferedAmount: () => number,
  options: { budgetBytes?: number; timeoutMs?: number; pollMs?: number } = {},
): Promise<boolean> {
  const budget = options.budgetBytes ?? HOST_SOCKET_SEND_BUDGET_BYTES;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollMs = options.pollMs ?? 16;
  const started = Date.now();
  while (bufferedAmount() >= budget) {
    if (Date.now() - started >= timeoutMs) {
      return false;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, pollMs);
    });
  }
  return true;
}
